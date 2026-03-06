import { getSdkHooks } from './shared/sdk-hooks.js';
import { ContainerSessionRuntime } from './container-session-runtime.js';
import type {
  SessionRuntime,
  SessionRuntimeContext,
  SessionRuntimeResult,
} from './session-runtime.js';

function unsupportedInProcessResult(
  context: SessionRuntimeContext,
): SessionRuntimeResult {
  return {
    response: {
      schemaVersion: 1,
      requestId: context.request.requestId,
      status: 'error',
      error: `No in-process runtime hook registered for ${context.lead.leadId}`,
      durationMs: 0,
      tokensUsed: { input: 0, output: 0 },
    },
    sessionId: context.sessionId,
    resumeAt: context.resumeAt,
  };
}

export class InProcessSessionRuntime implements SessionRuntime {
  async run(context: SessionRuntimeContext): Promise<SessionRuntimeResult> {
    const hooks = getSdkHooks();
    if (!hooks.runInProcessSession) {
      return unsupportedInProcessResult(context);
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
    this.inProcessRuntime = options.inProcessRuntime ?? new InProcessSessionRuntime();
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
