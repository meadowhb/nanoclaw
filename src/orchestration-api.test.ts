import { describe, expect, it, vi } from 'vitest';

import { handleOrchestrationRequest } from './orchestration-api.js';
import type { RunTeamDeps } from './orchestrator.js';
import type { PodResult } from './orchestration-types.js';

function createResponseHarness() {
  const chunks: string[] = [];

  return {
    response: {
      writeHead: vi.fn(() => undefined),
      write: vi.fn((chunk: string) => {
        chunks.push(chunk);
      }),
      end: vi.fn(() => undefined),
    },
    body: () => chunks.join(''),
  };
}

function makePodResult(overrides: Partial<PodResult> = {}): PodResult {
  return {
    podId: 'pod-1',
    formation: 'demo',
    status: 'succeeded',
    result: { ok: true },
    memberResults: {},
    artifacts: [],
    durationMs: 1,
    tokensUsed: { input: 0, output: 0 },
    ...overrides,
  };
}

describe('orchestration-api', () => {
  it('returns 400 json when the request body is invalid', async () => {
    const harness = createResponseHarness();

    await handleOrchestrationRequest(harness.response, { nope: true });

    expect(harness.response.writeHead).toHaveBeenCalledWith(400, {
      'Content-Type': 'application/json',
    });
    expect(harness.response.end).toHaveBeenCalledWith(
      expect.stringContaining('"error":"validation_error"'),
    );
  });

  it('streams orchestrator events as SSE and closes the response', async () => {
    const harness = createResponseHarness();
    const runTeamFn = vi.fn(
      async (_formation, deps: RunTeamDeps): Promise<PodResult> => {
        await deps.appendEventFn?.(null, '/tmp', {
          podId: 'pod-1',
          eventType: 'pod_started',
          payload: { formation: 'demo' },
        });
        await deps.appendEventFn?.(null, '/tmp', {
          podId: 'pod-1',
          eventType: 'lead_delegated',
          member: 'engineering-lead',
          payload: { objective: 'review' },
        });
        return makePodResult();
      },
    );

    await handleOrchestrationRequest(
      harness.response,
      {
        formation: {
          name: 'demo',
          objective: 'Do work',
          leads: ['engineering-lead'],
          coordinatorId: 'engineering-lead',
          timeout: 30,
          visibility: 'medium',
        },
        humanChatJid: 'human@chat',
        timeout: 30,
      },
      { runTeamFn },
    );

    expect(harness.response.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    expect(harness.body()).toContain('event: pod_started');
    expect(harness.body()).toContain('event: lead_delegated');
    expect(harness.body()).toContain('event: pod_completed');
    expect(harness.response.end).toHaveBeenCalledTimes(1);
  });
});
