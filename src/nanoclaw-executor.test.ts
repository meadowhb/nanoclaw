import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _initTestDatabase,
  getLeadConversationBinding,
} from './db.js';
import { createLeadRegistry } from './lead-registry.js';
import { NanoclawExecutor } from './nanoclaw-executor.js';
import { NanoclawProvisioner } from './nanoclaw-provisioner.js';
import type { LeadBlueprint } from './orchestration-types.js';
import { RuntimeManager } from './runtime-manager.js';
import type {
  SessionRuntime,
  SessionRuntimeContext,
  SessionRuntimeResult,
} from './session-runtime.js';

let tempRoot = '';

function makeLead(
  leadId: string,
  team: LeadBlueprint['team'],
  executionMode: 'containerized' | 'in_process',
  allowedTools: string[],
): LeadBlueprint {
  return {
    leadId,
    team,
    soul: `Soul for ${leadId}`,
    model: 'sonnet',
    channel: `${leadId}@team`,
    maxConcurrentPods: 2,
    defaultTimeout: 60,
    runtime: {
      executionMode,
      allowedTools,
    },
  };
}

function makeRequest(overrides: Partial<SessionRuntimeContext['request']> = {}) {
  return {
    schemaVersion: 1 as const,
    requestId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    attempt: 1,
    podId: 'pod-1',
    objective: 'Do the work',
    payload: { scope: 'mvp' },
    workspacePath: '/workspace',
    timeout: 30,
    ...overrides,
  };
}

function successResult(
  context: SessionRuntimeContext,
  result: unknown,
  sessionId: string,
  resumeAt: string,
): SessionRuntimeResult {
  return {
    response: {
      schemaVersion: 1,
      requestId: context.request.requestId,
      status: 'success',
      result,
      durationMs: 1,
      tokensUsed: { input: 0, output: 0 },
    },
    sessionId,
    resumeAt,
  };
}

beforeEach(() => {
  _initTestDatabase();
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-executor-'));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('nanoclaw-executor', () => {
  it('persists and resumes in-process conversations with the configured MCP tool surface', async () => {
    const supportLead = makeLead(
      'support-lead',
      'support',
      'in_process',
      ['report_progress'],
    );
    const registry = createLeadRegistry([supportLead]);
    const inProcessRuntime: SessionRuntime = {
      run: vi
        .fn<SessionRuntime['run']>()
        .mockImplementationOnce(async (context) => {
          const toolResult = await context.mcpTools[0]?.invoke({ step: 'first' });
          return successResult(
            context,
            toolResult,
            'session-support',
            'resume-1',
          );
        })
        .mockImplementationOnce(async (context) => {
          return successResult(
            context,
            {
              resumedFrom: context.sessionId,
              resumeAt: context.resumeAt,
            },
            'session-support',
            'resume-2',
          );
        }),
    };
    const executor = new NanoclawExecutor({
      dataDir: tempRoot,
      leadRegistry: registry,
      provisioner: new NanoclawProvisioner({
        dataDir: tempRoot,
        groupsDir: path.join(tempRoot, 'groups'),
        sessionsDir: path.join(tempRoot, 'sessions'),
      }),
      runtimeManager: new RuntimeManager({
        inProcessRuntime,
        containerizedRuntime: { run: vi.fn() },
      }),
    });

    const first = await executor.sendWork(
      'support-lead',
      makeRequest(),
      supportLead.channel,
    );
    const second = await executor.sendWork(
      'support-lead',
      makeRequest({
        requestId: '33333333-3333-4333-8333-333333333333',
        idempotencyKey: '44444444-4444-4444-8444-444444444444',
      }),
      supportLead.channel,
    );

    expect(first).toMatchObject({
      status: 'success',
      result: {
        tool: 'report_progress',
        accepted: true,
        input: { step: 'first' },
      },
    });
    expect(second).toMatchObject({
      status: 'success',
      result: {
        resumedFrom: 'session-support',
        resumeAt: 'resume-1',
      },
    });

    const firstCall = vi.mocked(inProcessRuntime.run).mock.calls[0]?.[0];
    const secondCall = vi.mocked(inProcessRuntime.run).mock.calls[1]?.[0];
    expect(firstCall?.mcpTools.map((tool) => tool.name)).toEqual([
      'report_progress',
    ]);
    expect(secondCall?.sessionId).toBe('session-support');
    expect(secondCall?.resumeAt).toBe('resume-1');
    expect(
      getLeadConversationBinding('support-lead', supportLead.channel, 'pod-1'),
    ).toMatchObject({
      sessionId: 'session-support',
      resumeAt: 'resume-2',
    });
  });

  it('routes containerized leads through the container runtime with the same tool surface contract', async () => {
    const engineeringLead = makeLead(
      'engineering-lead',
      'engineering',
      'containerized',
      ['bash', 'write_workspace'],
    );
    const registry = createLeadRegistry([engineeringLead]);
    const containerizedRuntime: SessionRuntime = {
      run: vi.fn(async (context) => {
        const toolResult = await context.mcpTools[1]?.invoke({
          file: 'README.md',
        });
        return successResult(
          context,
          toolResult,
          'session-engineering',
          'resume-engineering',
        );
      }),
    };
    const executor = new NanoclawExecutor({
      dataDir: tempRoot,
      leadRegistry: registry,
      provisioner: new NanoclawProvisioner({
        dataDir: tempRoot,
        groupsDir: path.join(tempRoot, 'groups'),
        sessionsDir: path.join(tempRoot, 'sessions'),
      }),
      runtimeManager: new RuntimeManager({
        inProcessRuntime: { run: vi.fn() },
        containerizedRuntime,
      }),
    });

    const result = await executor.sendWork(
      'engineering-lead',
      makeRequest(),
      engineeringLead.channel,
    );

    expect(result).toMatchObject({
      status: 'success',
      result: {
        tool: 'write_workspace',
        accepted: true,
        input: { file: 'README.md' },
      },
    });
    expect(vi.mocked(containerizedRuntime.run)).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(containerizedRuntime.run)
        .mock.calls[0]?.[0]
        .mcpTools.map((tool) => tool.name),
    ).toEqual(['bash', 'write_workspace']);
  });
});
