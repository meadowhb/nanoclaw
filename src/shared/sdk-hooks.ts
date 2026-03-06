import type {
  SessionRuntimeContext,
  SessionRuntimeResult,
} from '../session-runtime.js';

export interface SdkHooks {
  runInProcessSession?: (
    context: SessionRuntimeContext,
  ) => Promise<SessionRuntimeResult>;
}

let hooks: SdkHooks = {};

export function getSdkHooks(): SdkHooks {
  return hooks;
}

export function setSdkHooks(next: SdkHooks): void {
  hooks = { ...next };
}

export function resetSdkHooks(): void {
  hooks = {};
}
