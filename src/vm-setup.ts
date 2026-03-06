import { execSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';

import { z } from 'zod';

import { handleOrchestrationRequest } from './orchestration-api.js';
import { logger } from './logger.js';

let configured = false;
let configuredAt = 0;

const SETUP_TOKEN = fs
  .readFileSync(path.join(process.cwd(), '.setup-token'), 'utf8')
  .trim();

const ConfigureRequest = z
  .object({
    assistantName: z.string().min(1),
    chatPlatform: z.enum(['telegram', 'whatsapp', 'discord', 'slack']),
    chatCredential: z.string().min(1),
    anthropicApiKey: z.string().startsWith('sk-ant-'),
    groups: z
      .array(
        z
          .object({
            folder: z.string().regex(/^[a-z0-9-]+$/),
            claudeMd: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const PLATFORM_ENV = {
  telegram: 'TELEGRAM_BOT_TOKEN',
  whatsapp: 'WHATSAPP_PHONE_ID',
  discord: 'DISCORD_BOT_TOKEN',
  slack: 'SLACK_BOT_TOKEN',
} as const;

export interface HealthResponse {
  status: 'warm' | 'live' | 'error';
  chatConnected?: boolean;
  registeredGroups?: number;
  uptime?: number;
  error?: string;
}

export function handleConfigure(body: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  if (configured) {
    return { status: 409, body: { error: 'already_configured' } };
  }

  const result = ConfigureRequest.safeParse(body);
  if (!result.success) {
    return {
      status: 400,
      body: {
        error: 'validation_error',
        details: result.error.issues,
      },
    };
  }

  const data = result.data;
  const platformEnvKey = PLATFORM_ENV[data.chatPlatform];
  const envContent = [
    `ASSISTANT_NAME=${data.assistantName}`,
    'AUTO_REGISTER=true',
    `ANTHROPIC_API_KEY=${data.anthropicApiKey}`,
    `${platformEnvKey}=${data.chatCredential}`,
  ].join('\n');

  fs.writeFileSync(path.join(process.cwd(), '.env'), `${envContent}\n`);
  for (const group of data.groups) {
    const groupDir = path.join(process.cwd(), 'groups', group.folder);
    fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(groupDir, 'CLAUDE.md'), group.claudeMd);
  }

  try {
    execSync('systemctl start nanoclaw.service', { timeout: 10000 });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start nanoclaw.service');
    return { status: 500, body: { error: 'service_start_failed' } };
  }

  configured = true;
  configuredAt = Date.now();
  logger.info('VM configured successfully');
  return { status: 200, body: { status: 'configured' } };
}

export async function handleHealth(): Promise<HealthResponse> {
  if (!configured) {
    return {
      status: 'warm',
      chatConnected: false,
      registeredGroups: 0,
      uptime: 0,
    };
  }

  let serviceState: string;
  try {
    serviceState = execSync('systemctl is-active nanoclaw.service', {
      timeout: 5000,
    })
      .toString()
      .trim();
  } catch {
    try {
      const failedState = execSync('systemctl is-failed nanoclaw.service', {
        timeout: 5000,
      })
        .toString()
        .trim();
      if (failedState === 'failed') {
        return {
          status: 'error',
          error: 'nanoclaw.service failed',
          uptime: 0,
        };
      }
    } catch {
      // fall through to inactive error
    }

    return {
      status: 'error',
      error: 'nanoclaw.service not active',
      uptime: 0,
    };
  }

  if (serviceState !== 'active') {
    return {
      status: 'error',
      error: `nanoclaw.service is ${serviceState}`,
      uptime: 0,
    };
  }

  try {
    const response = await fetch('http://localhost:8081/health');
    const healthData = (await response.json()) as Record<string, unknown>;
    return {
      status: 'live',
      chatConnected: true,
      registeredGroups:
        typeof healthData.registeredGroups === 'number'
          ? healthData.registeredGroups
          : 0,
      uptime: Math.floor((Date.now() - configuredAt) / 1000),
      ...healthData,
    };
  } catch {
    return {
      status: 'live',
      chatConnected: false,
      registeredGroups: 0,
      uptime: Math.floor((Date.now() - configuredAt) / 1000),
    };
  }
}

export function checkAuth(req: http.IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${SETUP_TOKEN}`;
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

export function startServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      if (!checkAuth(req)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      sendJson(res, 200, await handleHealth());
      return;
    }

    if (req.method === 'POST' && req.url === '/configure') {
      if (!checkAuth(req)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const result = handleConfigure(body);
        sendJson(res, result.status, result.body);
      } catch {
        sendJson(res, 400, { error: 'invalid_json' });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/orchestrate') {
      if (!checkAuth(req)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }

      try {
        const body = await readJsonBody(req);
        await handleOrchestrationRequest(res, body);
      } catch {
        sendJson(res, 400, { error: 'invalid_json' });
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(8080, '0.0.0.0', () => {
    logger.info('VM setup server listening on :8080');
  });

  return server;
}

const isDirectRun =
  process.argv[1]?.endsWith('vm-setup.ts') ||
  process.argv[1]?.endsWith('vm-setup.js');

if (isDirectRun) {
  startServer();
}
