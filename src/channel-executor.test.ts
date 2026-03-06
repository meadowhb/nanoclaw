import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelExecutor, type OnMessage } from './channel-executor.js';
import {
  formatChannelMessage,
  parseChannelMessage,
} from './channel-protocol.js';
import type { AgentRequest } from './orchestration-types.js';

interface Harness {
  executor: ChannelExecutor;
  mockChannel: { sendMessage: ReturnType<typeof vi.fn> };
  simulateInbound: (text: string) => void;
  unsubscribed: () => boolean;
}

function makeRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    schemaVersion: 1,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    attempt: 1,
    podId: 'pod-a',
    objective: 'finish task',
    payload: { message: 'hello' },
    workspacePath: '/tmp/ws',
    timeout: 0.05,
    ...overrides,
  };
}

function createHarness(options?: { pollIntervalMs?: number }): Harness {
  let inboundCallback: ((chatJid: string, text: string) => void) | null = null;
  let didUnsubscribe = false;

  const onMessage: OnMessage = (callback) => {
    inboundCallback = callback;
    return () => {
      didUnsubscribe = true;
      inboundCallback = null;
    };
  };

  const mockChannel = {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };

  const executor = new ChannelExecutor(mockChannel, onMessage, options);

  const simulateInbound = (text: string): void => {
    inboundCallback?.('test-channel', text);
  };

  return {
    executor,
    mockChannel,
    simulateInbound,
    unsubscribed: () => didUnsubscribe,
  };
}

describe('ChannelExecutor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sendWork sends formatted request and resolves on matching response', async () => {
    const harness = createHarness({ pollIntervalMs: 10 });
    const request = makeRequest();
    const pending = harness.executor.sendWork(
      'worker-1',
      request,
      'test@channel',
    );

    expect(harness.mockChannel.sendMessage).toHaveBeenCalledTimes(1);
    const [sentJid, sentText] = harness.mockChannel.sendMessage.mock
      .calls[0] as [string, string];
    expect(sentJid).toBe('test@channel');
    expect(sentText).toContain(`[MC:work_request:${request.requestId}]`);
    const sentEnvelope = parseChannelMessage(sentText);
    expect(sentEnvelope?.payload).toEqual({
      recipientId: 'worker-1',
      request,
    });

    harness.simulateInbound(
      formatChannelMessage({
        schemaVersion: 1,
        type: 'work_response',
        requestId: request.requestId,
        senderId: 'worker-1',
        timestamp: Date.now(),
        payload: {
          schemaVersion: 1,
          requestId: request.requestId,
          status: 'success',
          result: { done: true },
          durationMs: 5,
          tokensUsed: { input: 1, output: 2 },
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toMatchObject({
      schemaVersion: 1,
      requestId: request.requestId,
      status: 'success',
      result: { done: true },
    });
  });

  it('sendWork returns timeout error when no response', async () => {
    const harness = createHarness({ pollIntervalMs: 10 });
    const request = makeRequest({ timeout: 1 });
    const pending = harness.executor.sendWork(
      'worker-1',
      request,
      'test@channel',
    );

    await vi.advanceTimersByTimeAsync(3_100);
    await expect(pending).resolves.toMatchObject({
      schemaVersion: 1,
      requestId: request.requestId,
      status: 'error',
      error: 'timeout',
      tokensUsed: { input: 0, output: 0 },
    });
  });

  it('sendWork retries with new requestId and same idempotencyKey on timeout', async () => {
    const harness = createHarness({ pollIntervalMs: 10 });
    const request = makeRequest({ timeout: 1 });
    const pending = harness.executor.sendWork(
      'worker-1',
      request,
      'test@channel',
    );

    await vi.advanceTimersByTimeAsync(3_100);
    await pending;

    expect(harness.mockChannel.sendMessage).toHaveBeenCalledTimes(3);
    const envelopes = harness.mockChannel.sendMessage.mock.calls.map(
      (call) => parseChannelMessage(call[1] as string)!,
    );
    const requestIds = envelopes.map((envelope) => envelope.requestId);
    expect(new Set(requestIds).size).toBe(3);
    const idempotencyKeys = envelopes.map(
      (envelope) =>
        (envelope.payload as { request: AgentRequest }).request.idempotencyKey,
    );
    expect(new Set(idempotencyKeys)).toEqual(new Set([request.idempotencyKey]));
  });

  it('validates matched response payload and returns invalid_response on parse failure', async () => {
    const harness = createHarness({ pollIntervalMs: 10 });
    const request = makeRequest();
    const pending = harness.executor.sendWork(
      'worker-1',
      request,
      'test@channel',
    );

    harness.simulateInbound(
      formatChannelMessage({
        schemaVersion: 1,
        type: 'work_response',
        requestId: request.requestId,
        senderId: 'worker-1',
        timestamp: Date.now(),
        payload: {
          malformed: true,
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(10);
    const response = await pending;
    expect(
      (harness.executor as unknown as { responseBuffer: Map<string, unknown> })
        .responseBuffer.size,
    ).toBe(0);
    expect(response).toMatchObject({
      schemaVersion: 1,
      requestId: request.requestId,
      status: 'error',
      error: 'invalid_response',
    });
  });

  it('ignores work_response envelopes from the wrong sender', async () => {
    const harness = createHarness({ pollIntervalMs: 10 });
    const request = makeRequest();
    const pending = harness.executor.sendWork(
      'worker-1',
      request,
      'test@channel',
    );

    harness.simulateInbound(
      formatChannelMessage({
        schemaVersion: 1,
        type: 'work_response',
        requestId: request.requestId,
        senderId: 'worker-2',
        timestamp: Date.now(),
        payload: {
          schemaVersion: 1,
          requestId: request.requestId,
          status: 'success',
          result: { done: false },
          durationMs: 5,
          tokensUsed: { input: 1, output: 2 },
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(10);

    harness.simulateInbound(
      formatChannelMessage({
        schemaVersion: 1,
        type: 'work_response',
        requestId: request.requestId,
        senderId: 'worker-1',
        timestamp: Date.now(),
        payload: {
          schemaVersion: 1,
          requestId: request.requestId,
          status: 'success',
          result: { done: true },
          durationMs: 5,
          tokensUsed: { input: 1, output: 2 },
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toMatchObject({
      status: 'success',
      result: { done: true },
    });
  });

  it('getPresence returns online/busy/offline based on heartbeat recency and status', async () => {
    const harness = createHarness({ pollIntervalMs: 10 });
    vi.setSystemTime(new Date('2026-03-04T12:00:00.000Z'));

    expect(await harness.executor.getPresence('worker-1')).toBe('offline');

    harness.simulateInbound(
      formatChannelMessage({
        schemaVersion: 1,
        type: 'heartbeat',
        requestId: randomUUID(),
        senderId: 'worker-1',
        timestamp: Date.now(),
        payload: { workerId: 'worker-1', status: 'idle' },
      }),
    );
    expect(await harness.executor.getPresence('worker-1')).toBe('online');

    harness.simulateInbound(
      formatChannelMessage({
        schemaVersion: 1,
        type: 'heartbeat',
        requestId: randomUUID(),
        senderId: 'worker-1',
        timestamp: Date.now(),
        payload: { workerId: 'worker-1', status: 'busy' },
      }),
    );
    expect(await harness.executor.getPresence('worker-1')).toBe('busy');
  });

  it('getPresence maps heartbeat senderId to workerId', async () => {
    const harness = createHarness({ pollIntervalMs: 10 });
    vi.setSystemTime(new Date('2026-03-04T12:00:00.000Z'));

    harness.simulateInbound(
      formatChannelMessage({
        schemaVersion: 1,
        type: 'heartbeat',
        requestId: randomUUID(),
        senderId: 'worker-1',
        timestamp: Date.now(),
        payload: { workerId: 'worker-1', status: 'idle' },
      }),
    );
    expect(await harness.executor.getPresence('worker-1')).toBe('online');

    vi.advanceTimersByTime(70_000);
    expect(await harness.executor.getPresence('worker-1')).toBe('online');

    vi.advanceTimersByTime(60_001);
    expect(await harness.executor.getPresence('worker-1')).toBe('offline');
  });

  it('dispose unsubscribes, clears maps, and cancels poll timers', async () => {
    const harness = createHarness({ pollIntervalMs: 20 });
    const request = makeRequest({ timeout: 1 });

    harness.simulateInbound(
      formatChannelMessage({
        schemaVersion: 1,
        type: 'heartbeat',
        requestId: randomUUID(),
        senderId: 'worker-1',
        timestamp: Date.now(),
        payload: { workerId: 'worker-1', status: 'idle' },
      }),
    );
    void harness.executor.sendWork('worker-1', request, 'test@channel');
    await Promise.resolve();

    await harness.executor.dispose();

    const privateState = harness.executor as unknown as {
      responseBuffer: Map<string, unknown>;
      heartbeats: Map<string, unknown>;
      pollTimerIds: Set<ReturnType<typeof setInterval>>;
    };
    expect(harness.unsubscribed()).toBe(true);
    expect(privateState.responseBuffer.size).toBe(0);
    expect(privateState.heartbeats.size).toBe(0);
    expect(privateState.pollTimerIds.size).toBe(0);
  });
});
