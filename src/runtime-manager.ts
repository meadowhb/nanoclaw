import {
  createSdkMcpServer,
  query,
  type McpServerConfig,
  type Query,
  type SDKResultMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { logger } from './logger.js';

export interface SessionConfig {
  leadId: string;
  prompt: string;
  systemPrompt: string;
  sessionId?: string;
  workingDir: string;
  skills: string[];
  additionalDirectories?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  timeout: number;
}

export interface SessionResult {
  status: 'success' | 'error';
  result: unknown;
  sessionId?: string;
  durationMs: number;
  tokensUsed: { input: number; output: number };
  error?: string;
}

export { createSdkMcpServer };

export interface RuntimeManagerOptions {
  maxConcurrentSessions?: number;
}

interface ActiveSession {
  id: string;
  leadId: string;
  query: Query;
  stopped: boolean;
}

class Semaphore {
  private readonly maxConcurrent: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return this.release;
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.active += 1;
    return this.release;
  }

  private readonly release = (): void => {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    next?.();
  };
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function extractTokens(message: SDKResultMessage): { input: number; output: number } {
  const usage = message.usage as Record<string, unknown> | undefined;
  return {
    input:
      safeNumber(usage?.input_tokens) +
      safeNumber(usage?.cache_creation_input_tokens) +
      safeNumber(usage?.cache_read_input_tokens),
    output: safeNumber(usage?.output_tokens),
  };
}

function buildSystemPrompt(config: SessionConfig): string {
  if (config.skills.length === 0) {
    return config.systemPrompt;
  }
  const skillText = config.skills.map((skill) => `- ${skill}`).join('\n');
  return `${config.systemPrompt}\n\nPreferred skills:\n${skillText}`;
}

async function* singlePromptStream(prompt: string): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: prompt },
    parent_tool_use_id: null,
    session_id: '',
  };
}

export class RuntimeManager {
  private readonly semaphore: Semaphore;
  private readonly sessionsById = new Map<string, ActiveSession>();
  private readonly sessionsByLead = new Map<string, Set<string>>();

  constructor(options: RuntimeManagerOptions = {}) {
    this.semaphore = new Semaphore(options.maxConcurrentSessions ?? 5);
  }

  async runSession(config: SessionConfig): Promise<SessionResult> {
    const startedAt = Date.now();
    if (config.timeout <= 0) {
      return {
        status: 'error',
        result: null,
        durationMs: Date.now() - startedAt,
        tokensUsed: { input: 0, output: 0 },
        error: 'Invalid timeout',
      };
    }

    const release = await this.semaphore.acquire();
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), config.timeout * 1000);
    const sessionKey = `${config.leadId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    let activeSession: ActiveSession | null = null;

    try {
      const activeQuery = query({
        prompt: singlePromptStream(config.prompt),
        options: {
          cwd: config.workingDir,
          additionalDirectories: config.additionalDirectories ?? [],
          resume: config.sessionId,
          allowedTools: config.allowedTools,
          disallowedTools: config.disallowedTools,
          mcpServers: config.mcpServers,
          settingSources: ['project'],
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: buildSystemPrompt(config),
          },
          abortController,
        },
      });

      activeSession = {
        id: sessionKey,
        leadId: config.leadId,
        query: activeQuery,
        stopped: false,
      };
      this.registerActiveSession(activeSession);

      let sessionId = config.sessionId;
      let result: unknown = null;
      let status: SessionResult['status'] = 'success';
      let errorMessage: string | undefined;
      let tokensUsed = { input: 0, output: 0 };

      for await (const message of activeQuery) {
        if (
          message.type === 'system' &&
          message.subtype === 'init' &&
          typeof message.session_id === 'string'
        ) {
          sessionId = message.session_id;
          continue;
        }

        if (message.type !== 'result') {
          continue;
        }

        tokensUsed = extractTokens(message);
        if (message.subtype === 'success') {
          status = 'success';
          result = message.result;
        } else {
          status = 'error';
          result = null;
          errorMessage =
            Array.isArray(message.errors) && message.errors.length > 0
              ? message.errors.join('; ')
              : message.subtype;
        }
      }

      return {
        status,
        result,
        sessionId,
        durationMs: Date.now() - startedAt,
        tokensUsed,
        error: errorMessage,
      };
    } catch (error) {
      const active = activeSession ?? this.sessionsById.get(sessionKey);
      const message = active?.stopped
        ? 'session_stopped'
        : abortController.signal.aborted
          ? 'timeout'
          : error instanceof Error
            ? error.message
            : String(error);
      logger.warn({ leadId: config.leadId, error: message }, 'Session execution failed');
      return {
        status: 'error',
        result: null,
        sessionId: config.sessionId,
        durationMs: Date.now() - startedAt,
        tokensUsed: { input: 0, output: 0 },
        error: message,
      };
    } finally {
      clearTimeout(timeoutId);
      this.unregisterActiveSession(sessionKey);
      release();
    }
  }

  async stopSession(leadId: string): Promise<void> {
    const sessionIds = this.sessionsByLead.get(leadId);
    if (!sessionIds || sessionIds.size === 0) {
      return;
    }

    await Promise.all(
      [...sessionIds].map(async (sessionId) => {
        const active = this.sessionsById.get(sessionId);
        if (!active) {
          return;
        }
        active.stopped = true;
        try {
          await active.query.interrupt();
        } catch {
          // Ignore control-plane errors while stopping.
        }
        try {
          active.query.close();
        } catch {
          // Ignore close failures.
        }
      }),
    );
  }

  async stopAll(): Promise<void> {
    const leadIds = [...this.sessionsByLead.keys()];
    await Promise.all(leadIds.map((leadId) => this.stopSession(leadId)));
  }

  getActiveCount(): number {
    return this.sessionsById.size;
  }

  isLeadActive(leadId: string): boolean {
    const sessionIds = this.sessionsByLead.get(leadId);
    return Boolean(sessionIds && sessionIds.size > 0);
  }

  private registerActiveSession(active: ActiveSession): void {
    this.sessionsById.set(active.id, active);
    const existing = this.sessionsByLead.get(active.leadId);
    if (existing) {
      existing.add(active.id);
      return;
    }
    this.sessionsByLead.set(active.leadId, new Set([active.id]));
  }

  private unregisterActiveSession(sessionId: string): void {
    const active = this.sessionsById.get(sessionId);
    if (!active) {
      return;
    }
    this.sessionsById.delete(sessionId);
    const byLead = this.sessionsByLead.get(active.leadId);
    if (!byLead) {
      return;
    }
    byLead.delete(sessionId);
    if (byLead.size === 0) {
      this.sessionsByLead.delete(active.leadId);
    }
  }
}
