import { describe, it, expect } from 'vitest';

import { WorkerPool, WorkerNotFoundError } from './concurrency.js';

describe('WorkerPool', () => {
  it('two pods alternate fairly', async () => {
    const pool = new WorkerPool({ maxConcurrentEngagements: 10 });
    pool.registerWorker('w1', { capacity: 1 });

    const releaseA1 = await pool.engage('w1', 'podA');

    const podBPromise = pool.engage('w1', 'podB');
    const podA2Promise = pool.engage('w1', 'podA');

    // Free the worker: podB should go next (podA already had the last grant)
    releaseA1();
    const releaseB1 = await podBPromise;
    releaseB1();

    const releaseA2 = await podA2Promise;
    releaseA2();
  });

  it('capacity blocks until release', async () => {
    const pool = new WorkerPool({ maxConcurrentEngagements: 10 });
    pool.registerWorker('w1', { capacity: 1 });

    const release1 = await pool.engage('w1', 'podA');
    let resolved = false;
    const pending = pool.engage('w1', 'podA').then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    release1();
    await pending;
    expect(resolved).toBe(true);
  });

  it('getAvailableWorkers reflects real-time availability', async () => {
    const pool = new WorkerPool({ maxConcurrentEngagements: 10 });
    pool.registerWorker('w1', { capacity: 1 });

    expect(pool.getAvailableWorkers()).toEqual([
      {
        workerId: 'w1',
        capacity: 1,
        engaged: 0,
        available: 1,
        queued: 0,
        queuedByPod: {},
        engagedByPod: {},
      },
    ]);

    const release = await pool.engage('w1', 'podA');

    expect(pool.getAvailableWorkers()[0]).toMatchObject({
      workerId: 'w1',
      capacity: 1,
      engaged: 1,
      available: 0,
      queued: 0,
      engagedByPod: { podA: 1 },
    });

    const queued = pool.engage('w1', 'podB');
    await Promise.resolve();

    expect(pool.getAvailableWorkers()[0]).toMatchObject({
      workerId: 'w1',
      queued: 1,
      queuedByPod: { podB: 1 },
      engagedByPod: { podA: 1 },
    });

    release();
    const releaseB = await queued;
    releaseB();

    await Promise.resolve();
    expect(pool.getAvailableWorkers()[0]).toMatchObject({
      workerId: 'w1',
      engaged: 0,
      available: 1,
      queued: 0,
      queuedByPod: {},
      engagedByPod: {},
    });
  });

  it('release triggers immediate dispatch (no polling)', async () => {
    const pool = new WorkerPool({ maxConcurrentEngagements: 10 });
    pool.registerWorker('w1', { capacity: 1 });

    const release = await pool.engage('w1', 'podA');

    let gotHandle = false;
    const queued = pool.engage('w1', 'podB').then((h) => {
      gotHandle = true;
      h();
    });

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(gotHandle).toBe(true);

    await queued;
  });

  it('global maxConcurrentEngagements is enforced', async () => {
    const pool = new WorkerPool({ maxConcurrentEngagements: 1 });
    pool.registerWorker('w1', { capacity: 1 });
    pool.registerWorker('w2', { capacity: 1 });

    const release1 = await pool.engage('w1', 'podA');

    let resolved = false;
    const p = pool.engage('w2', 'podB').then((h) => {
      resolved = true;
      h();
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    release1();
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(true);

    await p;
  });

  it('unknown worker throws', async () => {
    const pool = new WorkerPool({ maxConcurrentEngagements: 1 });
    await expect(pool.engage('missing', 'podA')).rejects.toBeInstanceOf(
      WorkerNotFoundError,
    );
  });
});
