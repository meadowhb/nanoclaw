import {
  parseChannelMessage,
  formatChannelMessage,
} from './channel-protocol.js';
import { randomUUID } from 'node:crypto';
import {
  AgentResponseSchema,
  type AgentRequest,
  type AgentResponse,
  type ChannelEnvelope,
  type WorkerExecutor,
} from './orchestration-types.js';

export type OnMessage = (
  callback: (chatJid: string, text: string) => void,
) => () => void;

interface ChannelExecutorOptions {
  pollIntervalMs?: number;
}

export class ChannelExecutor implements WorkerExecutor {
  private readonly channel: {
    sendMessage(jid: string, text: string): Promise<void>;
  };

  private readonly pollIntervalMs: number;
  private readonly responseBuffer = new Map<string, ChannelEnvelope>();
  private readonly heartbeats = new Map<
    string,
    { timestamp: number; status: string }
  >();
  private readonly unsubscribeInbound: () => void;
  private readonly pollTimerIds = new Set<ReturnType<typeof setInterval>>();
  private isDisposed = false;

  constructor(
    channel: { sendMessage(jid: string, text: string): Promise<void> },
    onMessage: OnMessage,
    options?: ChannelExecutorOptions,
  ) {
    this.channel = channel;
    this.pollIntervalMs = options?.pollIntervalMs ?? 2000;
    this.unsubscribeInbound = onMessage(this.onInboundMessage);
  }

  private readonly onInboundMessage = (
    _chatJid: string,
    text: string,
  ): void => {
    const envelope = parseChannelMessage(text);
    if (!envelope) {
      return;
    }

    if (envelope.type === 'work_response') {
      this.responseBuffer.set(envelope.requestId, envelope);
      return;
    }

    if (envelope.type === 'heartbeat') {
      const payload = envelope.payload as Record<string, unknown> | null;
      if (
        payload &&
        typeof payload.workerId === 'string' &&
        payload.workerId === envelope.senderId &&
        typeof payload.status === 'string'
      ) {
        this.heartbeats.set(envelope.senderId, {
          timestamp: envelope.timestamp,
          status: payload.status,
        });
      }
    }
  };

  async sendWork(
    workerId: string,
    request: AgentRequest,
    channelJid: string,
  ): Promise<AgentResponse> {
    if (this.isDisposed) {
      return {
        schemaVersion: 1,
        requestId: request.requestId,
        status: 'error',
        error: 'timeout',
        durationMs: 0,
        tokensUsed: { input: 0, output: 0 },
      };
    }

    const startedAt = Date.now();
    const maxRetries = 2;
    let attemptRequest = request;

    for (let retry = 0; retry <= maxRetries; retry += 1) {
      await this.sendWorkRequest(workerId, attemptRequest, channelJid);

      const buffered = await this.pollForResponse(
        attemptRequest.requestId,
        attemptRequest.timeout * 1000,
        workerId,
      );
      if (buffered) {
        this.responseBuffer.delete(attemptRequest.requestId);
        const parsed = AgentResponseSchema.safeParse(buffered.payload);
        if (parsed.success) {
          return parsed.data as AgentResponse;
        }

        return {
          schemaVersion: 1,
          requestId: attemptRequest.requestId,
          status: 'error',
          error: 'invalid_response',
          durationMs: Date.now() - startedAt,
          tokensUsed: { input: 0, output: 0 },
        };
      }

      this.responseBuffer.delete(attemptRequest.requestId);

      if (retry < maxRetries) {
        attemptRequest = {
          ...attemptRequest,
          requestId: randomUUID(),
          idempotencyKey: request.idempotencyKey,
          attempt: attemptRequest.attempt + 1,
        };
      }

      if (this.isDisposed) {
        break;
      }
    }

    return {
      schemaVersion: 1,
      requestId: request.requestId,
      status: 'error',
      error: 'timeout',
      durationMs: Date.now() - startedAt,
      tokensUsed: { input: 0, output: 0 },
    };
  }

  private async sendWorkRequest(
    workerId: string,
    request: AgentRequest,
    channelJid: string,
  ): Promise<void> {
    const envelope: ChannelEnvelope = {
      schemaVersion: 1,
      type: 'work_request',
      requestId: request.requestId,
      senderId: 'orchestrator',
      timestamp: Date.now(),
      payload: {
        recipientId: workerId,
        request,
      },
    };

    await this.channel.sendMessage(channelJid, formatChannelMessage(envelope));
  }

  private pollForResponse(
    requestId: string,
    timeoutMs: number,
    workerId: string,
  ): Promise<ChannelEnvelope | null> {
    if (this.isDisposed) {
      return Promise.resolve(null);
    }

    const startedAt = Date.now();

    return new Promise<ChannelEnvelope | null>((resolve) => {
      const timerId = setInterval(() => {
        const buffered = this.responseBuffer.get(requestId);
        if (buffered && buffered.senderId === workerId) {
          clearInterval(timerId);
          this.pollTimerIds.delete(timerId);
          resolve(buffered);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timerId);
          this.pollTimerIds.delete(timerId);
          resolve(null);
        }
      }, this.pollIntervalMs);

      this.pollTimerIds.add(timerId);
    });
  }

  async getPresence(workerId: string): Promise<'online' | 'offline' | 'busy'> {
    const heartbeat = this.heartbeats.get(workerId);
    if (!heartbeat) {
      return 'offline';
    }

    const ageMs = Date.now() - heartbeat.timestamp;
    if (ageMs > 120_000) {
      return 'offline';
    }
    if (ageMs < 60_000 && heartbeat.status === 'busy') {
      return 'busy';
    }

    return 'online';
  }

  async dispose(): Promise<void> {
    this.isDisposed = true;
    this.unsubscribeInbound();
    for (const timerId of this.pollTimerIds) {
      clearInterval(timerId);
    }
    this.pollTimerIds.clear();
    this.responseBuffer.clear();
    this.heartbeats.clear();
  }
}
