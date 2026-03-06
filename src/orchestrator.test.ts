import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatChannelMessage,
  parseChannelMessage,
} from './channel-protocol.js';
import {
  createDelegateToLeadHandler,
  createEscalateToHumanHandler,
  createReportProgressHandler,
  handleToolCallEnvelope,
  runTeam,
  type ToolCallPayload,
  type ToolResultPayload,
} from './orchestrator.js';
import { createLeadRegistry, DEFAULT_COS } from './lead-registry.js';
import type {
  AgentRequest,
  AgentResponse,
  ChannelEnvelope,
  LeadSpec,
  PodFormation,
} from './orchestration-types.js';

afterEach(() => {
  vi.useRealTimers();
});

function makeEnvelope(
  overrides: Partial<ChannelEnvelope> = {},
): ChannelEnvelope {
  return {
    schemaVersion: 1,
    type: 'tool_call',
    requestId: randomUUID(),
    senderId: 'chief-of-staff',
    timestamp: Date.now(),
    payload: {
      podId: 'pod-1',
      tool: 'report_progress',
      args: { text: 'status' },
    } satisfies ToolCallPayload,
    ...overrides,
  };
}

function makeSuccessResponse(
  overrides: Partial<Extract<AgentResponse, { status: 'success' }>> = {},
): AgentResponse {
  return {
    schemaVersion: 1,
    requestId: randomUUID(),
    status: 'success',
    result: { ok: true },
    durationMs: 12,
    tokensUsed: { input: 10, output: 5 },
    ...overrides,
  };
}

function makeErrorResponse(
  overrides: Partial<Extract<AgentResponse, { status: 'error' }>> = {},
): AgentResponse {
  return {
    schemaVersion: 1,
    requestId: randomUUID(),
    status: 'error',
    error: 'boom',
    durationMs: 12,
    tokensUsed: { input: 10, output: 5 },
    ...overrides,
  };
}

describe('orchestrator.handleToolCallEnvelope', () => {
  it('accepts valid CoS tool_call and replies with tool_result using same callId', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    const envelope = makeEnvelope({
      payload: {
        podId: 'pod-1',
        tool: 'delegate_to_lead',
        args: {
          leadId: 'engineering-lead',
          objective: 'Implement x',
        },
      },
    });

    const handled = await handleToolCallEnvelope({
      podId: 'pod-1',
      envelope,
      channelJid: 'team@chat',
      sendMessage,
      allowedToolCallers: new Set(['chief-of-staff', 'engineering-lead']),
      handlers: {
        delegate_to_lead: async () => ({ ok: true }),
        report_progress: async () => ({ sent: true }),
        escalate_to_human: async () => ({ questionSent: true }),
      },
    });

    expect(handled).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, text] = sendMessage.mock.calls[0] as [string, string];
    const parsed = parseChannelMessage(text);
    expect(parsed?.type).toBe('tool_result');
    expect(parsed?.requestId).toBe(envelope.requestId);
    expect(parsed?.payload).toMatchObject({
      podId: 'pod-1',
      result: { ok: true },
    });
  });

  it('ignores tool_call from a sender outside allowedToolCallers', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const handled = await handleToolCallEnvelope({
      podId: 'pod-1',
      envelope: makeEnvelope({ senderId: 'worker-1' }),
      channelJid: 'team@chat',
      sendMessage,
      allowedToolCallers: new Set(['chief-of-staff', 'engineering-lead']),
      handlers: {
        delegate_to_lead: async () => ({ ok: true }),
        report_progress: async () => ({ sent: true }),
        escalate_to_human: async () => ({ questionSent: true }),
      },
    });

    expect(handled).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ignores malformed tool_call payloads without throwing', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const malformed = makeEnvelope({
      payload: {
        podId: 'pod-1',
        tool: 'unknown-tool',
        args: {},
      },
    });

    await expect(
      handleToolCallEnvelope({
        podId: 'pod-1',
        envelope: malformed,
        channelJid: 'team@chat',
        sendMessage,
        allowedToolCallers: new Set(['chief-of-staff']),
        handlers: {
          delegate_to_lead: async () => ({ ok: true }),
          report_progress: async () => ({ sent: true }),
          escalate_to_human: async () => ({ questionSent: true }),
        },
      }),
    ).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ignores tool_call for other pods', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const handled = await handleToolCallEnvelope({
      podId: 'pod-1',
      envelope: makeEnvelope({
        payload: {
          podId: 'pod-2',
          tool: 'report_progress',
          args: { text: 'status' },
        },
      }),
      channelJid: 'team@chat',
      sendMessage,
      allowedToolCallers: new Set(['chief-of-staff']),
      handlers: {
        delegate_to_lead: async () => ({ ok: true }),
        report_progress: async () => ({ sent: true }),
        escalate_to_human: async () => ({ questionSent: true }),
      },
    });

    expect(handled).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('orchestrator.report_progress + escalate_to_human', () => {
  it('report_progress visibility low does not send and returns sent=false reason', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const handler = createReportProgressHandler({
      podId: 'pod-1',
      visibility: 'low',
      humanChannel: { sendMessage },
      humanChatJid: 'human@chat',
    });

    const result = await handler({ text: 'update' }, {} as ToolCallPayload);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      podId: 'pod-1',
      result: { sent: false, reason: 'visibility_low' },
    });
  });

  it('report_progress visibility high sends message and returns sent=true', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const handler = createReportProgressHandler({
      podId: 'pod-1',
      visibility: 'high',
      humanChannel: { sendMessage },
      humanChatJid: 'human@chat',
    });

    const result = await handler(
      { text: 'milestone reached' },
      {} as ToolCallPayload,
    );
    expect(sendMessage).toHaveBeenCalledWith('human@chat', 'milestone reached');
    expect(result).toMatchObject({ podId: 'pod-1', result: { sent: true } });
  });

  it('escalate_to_human sends question, logs escalation, and returns first plain-text reply', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const appendEvent = vi.fn(async () => undefined);
    let inbound: ((chatJid: string, text: string) => void) | null = null;
    const onMessage = vi.fn((cb: (chatJid: string, text: string) => void) => {
      inbound = cb;
      return () => {
        inbound = null;
      };
    });

    const handler = createEscalateToHumanHandler({
      podId: 'pod-1',
      humanChannel: { sendMessage, onMessage },
      humanChatJid: 'human@chat',
      db: {},
      dataDir: '/tmp',
      appendEvent,
      timeoutMs: 300_000,
    });

    const pending = handler(
      {
        question: 'Proceed with launch?',
        context: { step: 3 },
      },
      {} as ToolCallPayload,
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith(
      'human@chat',
      expect.stringContaining('Proceed with launch?'),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      {},
      '/tmp',
      expect.objectContaining({
        eventType: 'escalation',
        payload: { question: 'Proceed with launch?', context: { step: 3 } },
      }),
    );
    const emitInbound = inbound as
      | ((chatJid: string, text: string) => void)
      | null;
    if (emitInbound) {
      emitInbound(
        'human@chat',
        formatChannelMessage({
          schemaVersion: 1,
          type: 'tool_result',
          requestId: randomUUID(),
          senderId: 'orchestrator',
          timestamp: Date.now(),
          payload: { podId: 'pod-1', result: 'ignore envelope' },
        }),
      );
      emitInbound('human@chat', 'Yes, proceed');
    }

    await expect(pending).resolves.toMatchObject({
      podId: 'pod-1',
      result: 'Yes, proceed',
    });
  });

  it('escalate_to_human times out at 300s and unsubscribes', async () => {
    vi.useFakeTimers();

    let inbound: ((chatJid: string, text: string) => void) | null = null;
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const appendEvent = vi.fn(async () => undefined);
    const unsubscribe = vi.fn(() => {
      inbound = null;
    });
    const onMessage = vi.fn((cb: (chatJid: string, text: string) => void) => {
      inbound = cb;
      return unsubscribe;
    });

    const handler = createEscalateToHumanHandler({
      podId: 'pod-1',
      humanChannel: { sendMessage, onMessage },
      humanChatJid: 'human@chat',
      db: {},
      dataDir: '/tmp',
      appendEvent,
      timeoutMs: 300_000,
    });

    const pending = handler(
      {
        question: 'Need decision?',
        context: {},
      },
      {} as ToolCallPayload,
    );

    await vi.advanceTimersByTimeAsync(300_100);
    await expect(pending).resolves.toMatchObject({
      podId: 'pod-1',
      error: 'No response from human (timeout)',
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(inbound).toBeNull();
  });
});

describe('orchestrator.createDelegateToLeadHandler', () => {
  function buildLeadSpec(overrides: Partial<LeadSpec> = {}): LeadSpec {
    return {
      leadId: 'engineering-lead',
      team: 'engineering',
      soul: 'Build product quality fast.',
      model: 'sonnet',
      channel: 'engineering@team',
      maxConcurrentPods: 2,
      defaultTimeout: 60,
      ...overrides,
    };
  }

  function createDeps() {
    const release = vi.fn();
    const pool = {
      engage: vi.fn(async () => release),
    };
    const executor = {
      sendWork: vi.fn(),
      getPresence: vi.fn(async () => 'online' as const),
      dispose: vi.fn(async () => undefined),
    };
    const appendEvent = vi.fn(async () => undefined);
    const state = {
      cumulative: 0,
      maxTokens: 200,
      budgetExceeded: false,
    };

    return {
      release,
      pool,
      executor,
      appendEvent,
      state,
      iterationCounts: new Map<string, number>(),
      idempotencyKeys: new Map<string, string>(),
    };
  }

  it('delegate_to_lead success engages lead, logs lead_result, and releases slot', async () => {
    const deps = createDeps();
    deps.executor.sendWork.mockResolvedValue(makeSuccessResponse());

    const registry = createLeadRegistry([buildLeadSpec()]);
    const handler = createDelegateToLeadHandler({
      podId: 'pod-1',
      formationLeadIds: new Set(['engineering-lead']),
      leadRegistry: registry,
      pool: deps.pool,
      executor: deps.executor,
      db: {},
      dataDir: '/tmp',
      appendEvent: deps.appendEvent,
      workspacePath: '/workspace',
      maxIterations: 3,
      iterationCounts: deps.iterationCounts,
      idempotencyKeys: deps.idempotencyKeys,
      state: deps.state,
    });

    const result = (await handler(
      {
        leadId: 'engineering-lead',
        objective: 'review PR',
        payload: { pr: 123 },
      },
      {} as ToolCallPayload,
    )) as ToolResultPayload;

    expect(result.error).toBeUndefined();
    expect(deps.pool.engage).toHaveBeenCalledWith('engineering-lead', 'pod-1');
    expect(deps.executor.sendWork).toHaveBeenCalledWith(
      'engineering-lead',
      expect.objectContaining({
        objective: 'review PR',
        attempt: 1,
      }),
      'engineering@team',
    );
    expect(deps.appendEvent).toHaveBeenCalledWith(
      {},
      '/tmp',
      expect.objectContaining({
        eventType: 'lead_result',
        member: 'engineering-lead',
      }),
    );
    expect(deps.release).toHaveBeenCalledTimes(1);
  });

  it('delegate_to_lead retries once on error with same idempotencyKey', async () => {
    const deps = createDeps();
    deps.executor.sendWork
      .mockResolvedValueOnce(makeErrorResponse())
      .mockResolvedValueOnce(makeSuccessResponse());

    const registry = createLeadRegistry([buildLeadSpec()]);
    const handler = createDelegateToLeadHandler({
      podId: 'pod-1',
      formationLeadIds: new Set(['engineering-lead']),
      leadRegistry: registry,
      pool: deps.pool,
      executor: deps.executor,
      db: {},
      dataDir: '/tmp',
      appendEvent: deps.appendEvent,
      workspacePath: '/workspace',
      maxIterations: 3,
      iterationCounts: deps.iterationCounts,
      idempotencyKeys: deps.idempotencyKeys,
      state: deps.state,
    });

    await handler(
      {
        leadId: 'engineering-lead',
        objective: 'implement feature',
        payload: { task: 1 },
      },
      {} as ToolCallPayload,
    );

    expect(deps.executor.sendWork).toHaveBeenCalledTimes(2);
    const firstReq = deps.executor.sendWork.mock.calls[0][1] as {
      requestId: string;
      idempotencyKey: string;
      attempt: number;
    };
    const secondReq = deps.executor.sendWork.mock.calls[1][1] as {
      requestId: string;
      idempotencyKey: string;
      attempt: number;
    };
    expect(secondReq.idempotencyKey).toBe(firstReq.idempotencyKey);
    expect(secondReq.requestId).not.toBe(firstReq.requestId);
    expect(secondReq.attempt).toBe(2);
    expect(deps.appendEvent).toHaveBeenCalledWith(
      {},
      '/tmp',
      expect.objectContaining({ eventType: 'lead_retry', attempt: 2 }),
    );
  });

  it('delegate_to_lead rejects unknown leads not in formation', async () => {
    const deps = createDeps();
    const registry = createLeadRegistry([buildLeadSpec()]);
    const handler = createDelegateToLeadHandler({
      podId: 'pod-1',
      formationLeadIds: new Set(['sales-lead']),
      leadRegistry: registry,
      pool: deps.pool,
      executor: deps.executor,
      db: {},
      dataDir: '/tmp',
      appendEvent: deps.appendEvent,
      workspacePath: '/workspace',
      maxIterations: 3,
      iterationCounts: deps.iterationCounts,
      idempotencyKeys: deps.idempotencyKeys,
      state: deps.state,
    });

    const result = (await handler(
      {
        leadId: 'engineering-lead',
        objective: 'review PR',
      },
      {} as ToolCallPayload,
    )) as ToolResultPayload;

    expect(result.error).toContain('is not in this formation');
    expect(deps.pool.engage).not.toHaveBeenCalled();
  });

  it('delegate_to_lead logs lead_timeout when final response is timeout error', async () => {
    const deps = createDeps();
    deps.executor.sendWork
      .mockResolvedValueOnce(makeErrorResponse())
      .mockResolvedValueOnce(makeErrorResponse({ error: 'timeout' }));

    const registry = createLeadRegistry([buildLeadSpec()]);
    const handler = createDelegateToLeadHandler({
      podId: 'pod-1',
      formationLeadIds: new Set(['engineering-lead']),
      leadRegistry: registry,
      pool: deps.pool,
      executor: deps.executor,
      db: {},
      dataDir: '/tmp',
      appendEvent: deps.appendEvent,
      workspacePath: '/workspace',
      maxIterations: 3,
      iterationCounts: deps.iterationCounts,
      idempotencyKeys: deps.idempotencyKeys,
      state: deps.state,
    });

    await handler(
      {
        leadId: 'engineering-lead',
        objective: 'review PR',
      },
      {} as ToolCallPayload,
    );

    expect(deps.appendEvent).toHaveBeenCalledWith(
      {},
      '/tmp',
      expect.objectContaining({ eventType: 'lead_timeout' }),
    );
  });
});

describe('orchestrator.runTeam lifecycle', () => {
  const engineeringLead: LeadSpec = {
    leadId: 'engineering-lead',
    team: 'engineering',
    soul: 'Lead engineering execution.',
    model: 'sonnet',
    channel: 'engineering@chat',
    maxConcurrentPods: 2,
    defaultTimeout: 60,
  };

  function makeFormation(overrides: Partial<PodFormation> = {}): PodFormation {
    return {
      name: 'eng-team',
      objective: 'Ship feature',
      leads: ['engineering-lead'],
      coordinatorId: 'chief-of-staff',
      timeout: 5,
      visibility: 'medium',
      ...overrides,
    };
  }

  function createChannels() {
    const teamCallbacks = new Set<(chatJid: string, text: string) => void>();
    const humanCallbacks = new Set<(chatJid: string, text: string) => void>();
    const teamChannel = {
      sendMessage: vi.fn(async (_jid: string, _text: string) => undefined),
      onMessage: vi.fn((cb: (chatJid: string, text: string) => void) => {
        teamCallbacks.add(cb);
        return () => {
          teamCallbacks.delete(cb);
        };
      }),
    };
    const humanChannel = {
      sendMessage: vi.fn(async (_jid: string, _text: string) => undefined),
      onMessage: vi.fn((cb: (chatJid: string, text: string) => void) => {
        humanCallbacks.add(cb);
        return () => {
          humanCallbacks.delete(cb);
        };
      }),
    };

    const emitTeam = (chatJid: string, text: string): void => {
      for (const callback of [...teamCallbacks]) {
        callback(chatJid, text);
      }
    };

    return {
      teamChannel,
      humanChannel,
      emitTeam,
    };
  }

  function getLatestWorkRequestEnvelope(teamChannel: {
    sendMessage: ReturnType<typeof vi.fn>;
  }): ChannelEnvelope | null {
    const calls = [...teamChannel.sendMessage.mock.calls].reverse();
    for (const call of calls) {
      const envelope = parseChannelMessage(call[1] as string);
      if (envelope?.type === 'work_request') {
        return envelope;
      }
    }
    return null;
  }

  it('returns failed with invalid_formation and zero fields for invalid input', async () => {
    const { teamChannel, humanChannel } = createChannels();
    const registry = createLeadRegistry([engineeringLead, DEFAULT_COS]);

    const result = await runTeam(
      { ...makeFormation(), leads: [] },
      {
        pool: {
          registerWorker: vi.fn(),
          engage: vi.fn(),
        },
        db: {},
        dataDir: '/tmp',
        workspacePath: '/workspace',
        teamChannel,
        humanChannel,
        humanChatJid: 'human@chat',
        leadRegistry: registry,
      },
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('invalid_formation');
    expect(result.durationMs).toBe(0);
    expect(result.tokensUsed).toEqual({ input: 0, output: 0 });
    expect(result.memberResults).toEqual({});
    expect(result.artifacts).toEqual([]);
  });

  it('happy path: tool_call delegate_to_lead then CoS work_response success', async () => {
    vi.useFakeTimers();
    const { teamChannel, humanChannel, emitTeam } = createChannels();
    const insertPodExecutionFn = vi.fn(async () => undefined);
    const appendEventFn = vi.fn(async () => undefined);
    const closePodExecutionFn = vi.fn(async () => undefined);
    const registerWorker = vi.fn();
    const pool = {
      registerWorker,
      engage: vi.fn(async () => () => undefined),
    };

    const registry = createLeadRegistry([engineeringLead, DEFAULT_COS]);
    const resultPromise = runTeam(makeFormation(), {
      pool,
      db: {},
      dataDir: '/tmp',
      workspacePath: '/workspace',
      teamChannel,
      humanChannel,
      humanChatJid: 'human@chat',
      leadRegistry: registry,
      insertPodExecutionFn,
      appendEventFn,
      closePodExecutionFn,
    });

    await vi.waitFor(() => {
      expect(teamChannel.sendMessage).toHaveBeenCalled();
    });

    const cosRequestEnvelope = getLatestWorkRequestEnvelope(teamChannel);
    if (!cosRequestEnvelope) {
      throw new Error('expected CoS work_request envelope');
    }

    const cosRequestPayload = cosRequestEnvelope.payload as {
      podId: string;
      requestId: string;
    };
    const cosPrompt = (
      cosRequestEnvelope.payload as { payload: { cosPrompt: string } }
    ).payload.cosPrompt;
    expect(cosPrompt).toContain('Lead roster:');
    expect(cosPrompt).toContain('`delegate_to_lead`');

    const toolCallRequestId = randomUUID();
    emitTeam(
      DEFAULT_COS.channel,
      formatChannelMessage({
        schemaVersion: 1,
        type: 'tool_call',
        requestId: toolCallRequestId,
        senderId: 'chief-of-staff',
        timestamp: Date.now(),
        payload: {
          podId: cosRequestPayload.podId,
          tool: 'delegate_to_lead',
          args: {
            leadId: 'engineering-lead',
            objective: 'Implement',
            payload: { scope: 'MVP' },
            timeout: 1,
          },
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => {
      const request = getLatestWorkRequestEnvelope(teamChannel);
      expect(
        (request?.payload as { request?: { objective?: string } })?.request
          ?.objective,
      ).toBe('Implement');
    });

    const leadRequestEnvelope = getLatestWorkRequestEnvelope(teamChannel);
    if (!leadRequestEnvelope) {
      throw new Error('expected delegated lead work_request envelope');
    }

    emitTeam(
      engineeringLead.channel,
      formatChannelMessage({
        schemaVersion: 1,
        type: 'work_response',
        requestId: leadRequestEnvelope.requestId,
        senderId: 'engineering-lead',
        timestamp: Date.now(),
        payload: {
          schemaVersion: 1,
          requestId: leadRequestEnvelope.requestId,
          status: 'success',
          result: { merged: true },
          workerTrace: [
            {
              name: 'codegen-worker',
              status: 'success',
              durationMs: 20,
              tokensUsed: { input: 5, output: 7 },
            },
          ],
          durationMs: 20,
          tokensUsed: { input: 10, output: 15 },
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(2_100);

    emitTeam(
      DEFAULT_COS.channel,
      formatChannelMessage({
        schemaVersion: 1,
        type: 'work_response',
        requestId: cosRequestEnvelope.requestId,
        senderId: 'chief-of-staff',
        timestamp: Date.now(),
        payload: {
          schemaVersion: 1,
          requestId: cosRequestEnvelope.requestId,
          status: 'success',
          result: { final: 'done' },
          durationMs: 40,
          tokensUsed: { input: 20, output: 30 },
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(50);

    const result = await resultPromise;
    expect(result.status).toBe('succeeded');
    expect(result.result).toEqual({ final: 'done' });
    expect(result.memberResults['engineering-lead']).toBeDefined();
    expect(registerWorker).toHaveBeenCalledWith('engineering-lead', {
      capacity: 2,
    });
    expect(closePodExecutionFn).toHaveBeenCalled();
  });

  it('returns timed_out when no CoS work_response arrives before timeout', async () => {
    vi.useFakeTimers();
    const { teamChannel, humanChannel } = createChannels();
    const registry = createLeadRegistry([engineeringLead, DEFAULT_COS]);

    const resultPromise = runTeam(makeFormation({ timeout: 1 }), {
      pool: {
        registerWorker: vi.fn(),
        engage: vi.fn(async () => () => undefined),
      },
      db: {},
      dataDir: '/tmp',
      workspacePath: '/workspace',
      teamChannel,
      humanChannel,
      humanChatJid: 'human@chat',
      leadRegistry: registry,
    });

    await vi.advanceTimersByTimeAsync(1_100);
    const result = await resultPromise;
    expect(result.status).toBe('timed_out');
    expect(result.error).toEqual({
      code: 'timeout',
      message: 'Formation timeout exceeded',
    });
  });

  it('uses a provided executor for delegated lead work while keeping the coordinator on the legacy channel path', async () => {
    vi.useFakeTimers();
    const { teamChannel, humanChannel, emitTeam } = createChannels();
    const sendWork = vi.fn(async (_workerId: string, request: AgentRequest) =>
      makeSuccessResponse({
        requestId: request.requestId,
        result: { hybrid: true },
      }),
    );
    const executor = {
      sendWork,
      getPresence: vi.fn(async () => 'online' as const),
      dispose: vi.fn(async () => undefined),
    };
    const registry = createLeadRegistry([engineeringLead, DEFAULT_COS]);

    const resultPromise = runTeam(makeFormation(), {
      pool: {
        registerWorker: vi.fn(),
        engage: vi.fn(async () => () => undefined),
      },
      db: {},
      dataDir: '/tmp',
      workspacePath: '/workspace',
      teamChannel,
      humanChannel,
      humanChatJid: 'human@chat',
      leadRegistry: registry,
      executor,
    });

    await vi.waitFor(() => {
      expect(teamChannel.sendMessage).toHaveBeenCalled();
    });

    const cosRequestEnvelope = getLatestWorkRequestEnvelope(teamChannel);
    if (!cosRequestEnvelope) {
      throw new Error('expected CoS work_request envelope');
    }

    const cosRequestPayload = cosRequestEnvelope.payload as { podId: string };

    emitTeam(
      DEFAULT_COS.channel,
      formatChannelMessage({
        schemaVersion: 1,
        type: 'tool_call',
        requestId: randomUUID(),
        senderId: 'chief-of-staff',
        timestamp: Date.now(),
        payload: {
          podId: cosRequestPayload.podId,
          tool: 'delegate_to_lead',
          args: {
            leadId: 'engineering-lead',
            objective: 'Implement with hybrid executor',
            timeout: 1,
          },
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(25);
    await vi.waitFor(() => {
      expect(sendWork).toHaveBeenCalledWith(
        'engineering-lead',
        expect.objectContaining({
          objective: 'Implement with hybrid executor',
        }),
        engineeringLead.channel,
      );
    });

    emitTeam(
      DEFAULT_COS.channel,
      formatChannelMessage({
        schemaVersion: 1,
        type: 'work_response',
        requestId: cosRequestEnvelope.requestId,
        senderId: 'chief-of-staff',
        timestamp: Date.now(),
        payload: {
          schemaVersion: 1,
          requestId: cosRequestEnvelope.requestId,
          status: 'success',
          result: { final: 'done' },
          durationMs: 40,
          tokensUsed: { input: 20, output: 30 },
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(25);

    const result = await resultPromise;
    expect(result.status).toBe('succeeded');
    expect(result.memberResults['engineering-lead']).toMatchObject({
      status: 'success',
      result: { hybrid: true },
    });
    expect(executor.dispose).toHaveBeenCalledTimes(1);
  });
});
