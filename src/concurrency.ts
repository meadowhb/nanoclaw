export type ReleaseHandle = () => void;

export interface WorkerStatus {
  workerId: string;
  capacity: number;
  engaged: number;
  available: number;
  queued: number;
  queuedByPod: Record<string, number>;
  engagedByPod: Record<string, number>;
}

export class WorkerNotFoundError extends Error {
  readonly workerId: string;

  constructor(workerId: string) {
    super(`Worker not found: ${workerId}`);
    this.name = 'WorkerNotFoundError';
    this.workerId = workerId;
  }
}

export interface WorkerPoolOptions {
  maxConcurrentEngagements: number;
}

export interface RegisterWorkerOptions {
  capacity?: number;
}

interface Waiter {
  podId: string;
  enqueueSeq: number;
  resolve: (handle: ReleaseHandle) => void;
}

interface WorkerState {
  capacity: number;
  engaged: number;
  engagedByPod: Map<string, number>;
  queuesByPod: Map<string, Waiter[]>;
  podLastGrantedSeq: Map<string, number>;
  grantSeq: number;
}

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be an integer >= 1`);
  }
}

export class WorkerPool {
  readonly maxConcurrentEngagements: number;

  private readonly workers = new Map<string, WorkerState>();
  private globalEngaged = 0;
  private drainScheduled = false;
  private drainCursor = 0;
  private enqueueSeq = 0;

  constructor(options: WorkerPoolOptions) {
    assertPositiveInt(
      options.maxConcurrentEngagements,
      'maxConcurrentEngagements',
    );
    this.maxConcurrentEngagements = options.maxConcurrentEngagements;
  }

  registerWorker(workerId: string, options?: RegisterWorkerOptions): void {
    const capacity = options?.capacity ?? 1;
    assertPositiveInt(capacity, 'capacity');

    const existing = this.workers.get(workerId);
    if (existing) {
      existing.capacity = capacity;
      this.scheduleDrain();
      return;
    }

    this.workers.set(workerId, {
      capacity,
      engaged: 0,
      engagedByPod: new Map(),
      queuesByPod: new Map(),
      podLastGrantedSeq: new Map(),
      grantSeq: 0,
    });
    this.scheduleDrain();
  }

  setWorkerCapacity(workerId: string, capacity: number): void {
    assertPositiveInt(capacity, 'capacity');
    const state = this.workers.get(workerId);
    if (!state) {
      throw new WorkerNotFoundError(workerId);
    }
    state.capacity = capacity;
    this.scheduleDrain();
  }

  engage(workerId: string, podId: string): Promise<ReleaseHandle> {
    const state = this.workers.get(workerId);
    if (!state) {
      return Promise.reject(new WorkerNotFoundError(workerId));
    }

    return new Promise<ReleaseHandle>((resolve) => {
      const canGrantNow =
        state.engaged < state.capacity &&
        this.globalEngaged < this.maxConcurrentEngagements &&
        state.queuesByPod.size === 0;

      if (canGrantNow) {
        resolve(this.grant(workerId, state, podId));
        return;
      }

      const waiter: Waiter = {
        podId,
        enqueueSeq: this.enqueueSeq++,
        resolve,
      };
      const queue = state.queuesByPod.get(podId);
      if (queue) {
        queue.push(waiter);
      } else {
        state.queuesByPod.set(podId, [waiter]);
      }

      this.scheduleDrain();
    });
  }

  getAvailableWorkers(): WorkerStatus[] {
    const statuses: WorkerStatus[] = [];
    for (const [workerId, state] of this.workers) {
      const queuedByPod: Record<string, number> = {};
      let queued = 0;
      for (const [podId, waiters] of state.queuesByPod) {
        queuedByPod[podId] = waiters.length;
        queued += waiters.length;
      }

      const engagedByPod: Record<string, number> = {};
      for (const [podId, count] of state.engagedByPod) {
        engagedByPod[podId] = count;
      }

      statuses.push({
        workerId,
        capacity: state.capacity,
        engaged: state.engaged,
        available: Math.max(0, state.capacity - state.engaged),
        queued,
        queuedByPod,
        engagedByPod,
      });
    }
    return statuses;
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  private drain(): void {
    if (this.globalEngaged >= this.maxConcurrentEngagements) return;

    const workerIds = Array.from(this.workers.keys());
    if (workerIds.length === 0) return;

    let progress = true;
    while (progress && this.globalEngaged < this.maxConcurrentEngagements) {
      progress = false;

      const start = this.drainCursor % workerIds.length;
      for (
        let offset = 0;
        offset < workerIds.length &&
        this.globalEngaged < this.maxConcurrentEngagements;
        offset++
      ) {
        const idx = (start + offset) % workerIds.length;
        const workerId = workerIds[idx]!;
        const state = this.workers.get(workerId);
        if (!state) continue;
        if (this.tryGrantOne(workerId, state)) {
          progress = true;
        }
      }

      this.drainCursor = (start + 1) % workerIds.length;
    }
  }

  private tryGrantOne(workerId: string, state: WorkerState): boolean {
    if (state.engaged >= state.capacity) return false;
    if (this.globalEngaged >= this.maxConcurrentEngagements) return false;
    if (state.queuesByPod.size === 0) return false;

    const selection = this.selectNextPod(state);
    if (!selection) return false;

    const { podId, waiter } = selection;
    waiter.resolve(this.grant(workerId, state, podId));
    return true;
  }

  private selectNextPod(
    state: WorkerState,
  ): { podId: string; waiter: Waiter } | null {
    let bestPodId: string | null = null;
    let bestLastGranted = Number.POSITIVE_INFINITY;
    let bestEnqueueSeq = Number.POSITIVE_INFINITY;

    for (const [podId, waiters] of state.queuesByPod) {
      if (waiters.length === 0) continue;

      const lastGranted = state.podLastGrantedSeq.get(podId) ?? -1;
      const headEnqueue = waiters[0]!.enqueueSeq;

      if (lastGranted < bestLastGranted) {
        bestPodId = podId;
        bestLastGranted = lastGranted;
        bestEnqueueSeq = headEnqueue;
        continue;
      }

      if (lastGranted > bestLastGranted) continue;

      if (headEnqueue < bestEnqueueSeq) {
        bestPodId = podId;
        bestEnqueueSeq = headEnqueue;
        continue;
      }

      if (headEnqueue > bestEnqueueSeq) continue;

      // Deterministic tie-breaker
      if (bestPodId == null || podId < bestPodId) {
        bestPodId = podId;
      }
    }

    if (!bestPodId) return null;
    const queue = state.queuesByPod.get(bestPodId);
    if (!queue || queue.length === 0) return null;

    const waiter = queue.shift()!;
    if (queue.length === 0) {
      state.queuesByPod.delete(bestPodId);
    }

    return { podId: bestPodId, waiter };
  }

  private grant(
    workerId: string,
    state: WorkerState,
    podId: string,
  ): ReleaseHandle {
    state.engaged++;
    this.globalEngaged++;

    state.engagedByPod.set(podId, (state.engagedByPod.get(podId) ?? 0) + 1);
    state.podLastGrantedSeq.set(podId, state.grantSeq++);

    let released = false;
    return () => {
      if (released) return;
      released = true;

      const live = this.workers.get(workerId);
      if (!live) return;

      live.engaged = Math.max(0, live.engaged - 1);
      this.globalEngaged = Math.max(0, this.globalEngaged - 1);

      const current = live.engagedByPod.get(podId) ?? 0;
      if (current <= 1) {
        live.engagedByPod.delete(podId);
      } else {
        live.engagedByPod.set(podId, current - 1);
      }

      this.scheduleDrain();
    };
  }
}
