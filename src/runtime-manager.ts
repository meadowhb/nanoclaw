import { InProcessSessionRuntime as ConcreteInProcessSessionRuntime } from './in-process-session-runtime.js';
import { getSdkHooks } from './shared/sdk-hooks.js';
import { ContainerSessionRuntime } from './container-session-runtime.js';
import type {
  SessionRuntime,
  SessionRuntimeContext,
  SessionRuntimeResult,
} from './session-runtime.js';

export class InProcessSessionRuntime implements SessionRuntime {
  async run(context: SessionRuntimeContext): Promise<SessionRuntimeResult> {
    const hooks = getSdkHooks();
    if (!hooks.runInProcessSession) {
      return new ConcreteInProcessSessionRuntime().run(context);
    }
    return hooks.runInProcessSession(context);
  }
}

export interface RuntimeManagerOptions {
  inProcessRuntime?: SessionRuntime;
  containerizedRuntime?: SessionRuntime;
}

export class RuntimeManager {
  private readonly inProcessRuntime: SessionRuntime;
  private readonly containerizedRuntime: SessionRuntime;

  constructor(options: RuntimeManagerOptions = {}) {
    this.inProcessRuntime =
      options.inProcessRuntime ?? new InProcessSessionRuntime();
    this.containerizedRuntime =
      options.containerizedRuntime ?? new ContainerSessionRuntime();
  }

  async run(context: SessionRuntimeContext): Promise<SessionRuntimeResult> {
    const mode = context.lead.runtime?.executionMode ?? 'in_process';
    if (mode === 'containerized') {
      return this.containerizedRuntime.run(context);
    }
    return this.inProcessRuntime.run(context);
  }

  async dispose(): Promise<void> {
    await this.inProcessRuntime.dispose?.();
    await this.containerizedRuntime.dispose?.();
  }
}
