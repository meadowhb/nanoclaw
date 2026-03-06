import type { AgentSpec } from '../orchestration-types.js';
import type { WorkerIdentity } from './types.js';

export function compileWorkerToAgentSpec(
  worker: WorkerIdentity,
  options: {
    group: string;
    timeout?: number;
  },
): AgentSpec {
  return {
    name: worker.id,
    role: 'member',
    prompt: worker.purpose,
    model: worker.model,
    timeout: options.timeout ?? 120,
    mode: 'single_turn',
    side_effects: 'none',
    soul: worker.purpose,
    identity: {
      group: options.group,
    },
  };
}
