import { describe, expect, it, vi } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: vi.fn(() => 'test-token'),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
  };
});

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    assistantName: 'TestBot',
    chatPlatform: 'telegram',
    chatCredential: '123:ABC',
    anthropicApiKey: 'sk-ant-test-key',
    groups: [{ folder: 'my-group', claudeMd: '# Test' }],
    ...overrides,
  };
}

describe('vm-setup', () => {
  async function freshModule() {
    vi.resetModules();
    return import('./vm-setup.js');
  }

  it('valid configure writes .env, creates dirs, and starts the service', async () => {
    const { handleConfigure } = await freshModule();
    const fsMod = (await import('fs')).default;
    const childProcess = await import('child_process');

    const result = handleConfigure(validPayload());

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('configured');
    const envWrite = vi
      .mocked(fsMod.writeFileSync)
      .mock.calls.find((call) => String(call[0]).endsWith('.env'));
    expect(envWrite).toBeDefined();
    expect(String(envWrite?.[1])).toContain('TELEGRAM_BOT_TOKEN=123:ABC');
    expect(vi.mocked(childProcess.execSync)).toHaveBeenCalledWith(
      'systemctl start nanoclaw.service',
      { timeout: 10000 },
    );
  });

  it('returns validation_error when anthropicApiKey is missing', async () => {
    const { handleConfigure } = await freshModule();
    const { assistantName, chatPlatform, chatCredential, groups } =
      validPayload();

    const result = handleConfigure({
      assistantName,
      chatPlatform,
      chatCredential,
      groups,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('validation_error');
  });

  it('returns 409 when configure is called twice', async () => {
    const { handleConfigure } = await freshModule();

    handleConfigure(validPayload());
    const result = handleConfigure(validPayload());

    expect(result.status).toBe(409);
    expect(result.body.error).toBe('already_configured');
  });

  it('health returns warm before configure', async () => {
    const { handleHealth } = await freshModule();

    const result = await handleHealth();

    expect(result.status).toBe('warm');
    expect(result.chatConnected).toBe(false);
  });

  it('checkAuth rejects a missing authorization header', async () => {
    const { checkAuth } = await freshModule();

    expect(checkAuth({ headers: {} } as never)).toBe(false);
  });
});
