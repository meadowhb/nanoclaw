import { describe, expect, it, vi } from 'vitest';

import { buildLeadInstance } from './lead-instances.js';
import type { LeadBlueprint } from './orchestration-types.js';
import { RuntimeManager } from './runtime-manager.js';
import type {
  SessionRuntime,
  SessionRuntimeContext,
  SessionRuntimeResult,
} from './session-runtime.js';

function makeLead(
  leadId: string,
  executionMode: 'containerized' | 'in_process',
): LeadBlueprint {
  return {
    leadId,
    team: leadId === 'engineering-lead' ? 'engineering' : 'support',
    soul: `Soul for ${leadId}`,
    model: 'sonnet',
    channel: `${leadId}@team`,
    maxConcurrentPods: 2,
    defaultTimeout: 60,
    runtime: {
      executionMode,
      allowedTools:
        executionMode === 'containerized' ? ['bash'] : ['report_progress'],
    },
  };
}

function makeContext(lead: LeadBlueprint): SessionRuntimeContext {
  return {
    lead,
    instance: buildLeadInstance('/tmp', lead),
    request: {
      schemaVersion: 1,
      requestId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      attempt: 1,
      podId: 'pod-1',
      objective: 'Ship it',
      payload: { scope: 'mvp' },
      workspacePath: '/workspace',
      timeout: 30,
    },
    channelJid: lead.channel,
    threadId: 'pod-1',
    mcpTools: [],
  };
}

describe('runtime-manager', () => {
  it('routes in-process and containerized leads to their matching runtimes', async () => {
    const successResult = (
      context: SessionRuntimeContext,
      mode: 'in_process' | 'containerized',
      sessionId: string,
      resumeAt: string,
    ): SessionRuntimeResult => ({
      response: {
        schemaVersion: 1,
        requestId: context.request.requestId,
        status: 'success',
        result: { mode },
        durationMs: 1,
        tokensUsed: { input: 0, output: 0 },
      },
      sessionId,
      resumeAt,
    });
    const inProcessRuntime: SessionRuntime = {
      run: vi.fn(async (context) =>
        successResult(
          context,
          'in_process',
          'sess-in-process',
          'resume-in-process',
        ),
      ),
    };
    const containerizedRuntime: SessionRuntime = {
      run: vi.fn(async (context) =>
        successResult(
          context,
          'containerized',
          'sess-container',
          'resume-container',
        ),
      ),
    };
    const manager = new RuntimeManager({
      inProcessRuntime,
      containerizedRuntime,
    });

    const inProcessResult = await manager.run(
      makeContext(makeLead('support-lead', 'in_process')),
    );
    const containerResult = await manager.run(
      makeContext(makeLead('engineering-lead', 'containerized')),
    );

    expect(inProcessRuntime.run).toHaveBeenCalledTimes(1);
    expect(containerizedRuntime.run).toHaveBeenCalledTimes(1);
    expect(inProcessResult.sessionId).toBe('sess-in-process');
    expect(containerResult.sessionId).toBe('sess-container');
  });
});
