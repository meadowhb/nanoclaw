import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeManager, type SessionConfig } from './runtime-manager.js';
import type { Query } from '@anthropic-ai/claude-agent-sdk';

const queryMock = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}));

function makeSessionConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    leadId: 'engineering-lead',
    prompt: 'Review the API changes',
    systemPrompt: 'You are an engineering lead.',
    sessionId: 'session-1',
    workingDir: '/tmp/metaclaw/leads/engineering-lead',
    skills: ['code-reviewer'],
    additionalDirectories: ['/tmp/metaclaw/context'],
    allowedTools: ['Read', 'Write'],
    disallowedTools: ['WebSearch'],
    timeout: 30,
    ...overrides,
  };
}

function createQuery(messages: unknown[], controls?: { interrupt?: ReturnType<typeof vi.fn>; close?: ReturnType<typeof vi.fn> }): Query {
  const iterator = (async function* () {
    for (const message of messages) {
      yield message;
    }
  })();

  return {
    next: iterator.next.bind(iterator),
    return: iterator.return?.bind(iterator),
    throw: iterator.throw?.bind(iterator),
    [Symbol.asyncIterator]: () => iterator,
    interrupt: controls?.interrupt ?? vi.fn(async () => undefined),
    close: controls?.close ?? vi.fn(),
  } as unknown as Query;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('RuntimeManager', () => {
  it('passes session config to query and maps result payload', async () => {
    queryMock.mockReturnValueOnce(
      createQuery([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'session-2',
        },
        {
          type: 'result',
          subtype: 'success',
          result: 'done',
          usage: {
            input_tokens: 11,
            output_tokens: 7,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 1,
          },
        },
      ]),
    );

    const manager = new RuntimeManager({ maxConcurrentSessions: 5 });
    const config = makeSessionConfig();
    const result = await manager.runSession(config);

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          cwd: config.workingDir,
          resume: config.sessionId,
          additionalDirectories: config.additionalDirectories,
          allowedTools: config.allowedTools,
          disallowedTools: config.disallowedTools,
          settingSources: ['project'],
          systemPrompt: expect.objectContaining({
            type: 'preset',
            preset: 'claude_code',
            append: expect.stringContaining(config.systemPrompt),
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      status: 'success',
      result: 'done',
      sessionId: 'session-2',
      tokensUsed: { input: 14, output: 7 },
    });
    expect(manager.getActiveCount()).toBe(0);
  });

  it('enforces max concurrent sessions and queues the sixth', async () => {
    const resolvers: Array<() => void> = [];
    queryMock.mockImplementation(() => {
      const iterator = (async function* () {
        await new Promise<void>((resolve) => {
          resolvers.push(resolve);
        });
        yield {
          type: 'result',
          subtype: 'success',
          result: 'ok',
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        };
      })();
      return {
        next: iterator.next.bind(iterator),
        return: iterator.return?.bind(iterator),
        throw: iterator.throw?.bind(iterator),
        [Symbol.asyncIterator]: () => iterator,
        interrupt: vi.fn(async () => undefined),
        close: vi.fn(),
      } as unknown as Query;
    });

    const manager = new RuntimeManager({ maxConcurrentSessions: 5 });
    const sessions = Array.from({ length: 6 }, (_, index) =>
      manager.runSession(
        makeSessionConfig({
          leadId: `lead-${index}`,
          sessionId: `session-${index}`,
        }),
      ),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(queryMock).toHaveBeenCalledTimes(5);
    expect(manager.getActiveCount()).toBe(5);

    const firstResolver = resolvers.shift();
    firstResolver?.();
    await sessions[0];

    await Promise.resolve();
    await Promise.resolve();
    expect(queryMock).toHaveBeenCalledTimes(6);

    for (const resolve of resolvers) {
      resolve();
    }
    await Promise.all(sessions);
    expect(manager.getActiveCount()).toBe(0);
  });
});
