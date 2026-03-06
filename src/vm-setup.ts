import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { z } from 'zod';

import {
  ackLeadBridgeOutbound,
  bootstrapLeadBridge,
  claimLeadBridgeOutbound,
  ingestLeadBridgeInbound,
} from './lead-bridge.js';
import { logger } from './logger.js';

let configured = false;
let configuredAt = 0;

const SETUP_TOKEN = fs
  .readFileSync(path.join(process.cwd(), '.setup-token'), 'utf8')
  .trim();

const ConfigureRequest = z.object({
  assistantName: z.string().min(1),
  chatPlatform: z.enum(['telegram', 'whatsapp', 'discord', 'slack']),
  chatCredential: z.string().min(1),
  anthropicApiKey: z.string().startsWith('sk-ant-'),
  groups: z
    .array(
      z.object({
        folder: z.string().regex(/^[a-z0-9-]+$/),
        claudeMd: z.string().min(1),
      }),
    )
    .min(1),
});

const LeadBridgeBootstrapRequest = z.object({
  teamId: z.string().min(1),
  workspaceId: z.string().min(1),
  leads: z.array(
    z.object({
      leadId: z.string().min(1),
      channelJid: z.string().min(1),
      folderSlug: z.string().min(1),
      soul: z.string().min(1),
    }),
  ),
});

const LeadBridgeInboundRequest = z.object({
  teamId: z.string().min(1),
  leadId: z.string().min(1),
  channelJid: z.string().min(1),
  threadJid: z.string().min(1),
  rootThreadTs: z.string().min(1),
  messageId: z.string().min(1),
  messageTs: z.string().min(1),
  senderId: z.string().min(1),
  senderName: z.string().min(1),
  text: z.string(),
});

const LeadBridgeClaimRequest = z
  .object({
    limit: z.number().int().positive().max(100).optional(),
  })
  .default({});

const LeadBridgeAckRequest = z.object({
  leaseId: z.string().min(1),
  messageId: z.string().min(1),
});

const PLATFORM_ENV: Record<string, string> = {
  telegram: 'TELEGRAM_BOT_TOKEN',
  whatsapp: 'WHATSAPP_PHONE_ID',
  discord: 'DISCORD_BOT_TOKEN',
  slack: 'SLACK_BOT_TOKEN',
};

function parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()) as T);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

export function handleConfigure(body: unknown) {
  if (configured) {
    return { status: 409, body: { error: 'already_configured' } };
  }

  const result = ConfigureRequest.safeParse(body);
  if (!result.success) {
    return {
      status: 400,
      body: { error: 'validation_error', details: result.error.issues },
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
    execSync('systemctl start nanoclaw.service', { timeout: 10_000 });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start nanoclaw.service');
    return { status: 500, body: { error: 'service_start_failed' } };
  }

  configured = true;
  configuredAt = Date.now();
  logger.info('VM configured successfully');
  return { status: 200, body: { status: 'configured' } };
}

export async function handleHealth() {
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
      timeout: 5_000,
    })
      .toString()
      .trim();
  } catch {
    try {
      const failCheck = execSync('systemctl is-failed nanoclaw.service', {
        timeout: 5_000,
      })
        .toString()
        .trim();
      if (failCheck === 'failed') {
        return { status: 'error', error: 'nanoclaw.service failed', uptime: 0 };
      }
    } catch {
      // ignore
    }
    return { status: 'error', error: 'nanoclaw.service not active', uptime: 0 };
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
      registeredGroups: healthData.registeredGroups ?? 0,
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

export function startServer() {
  const server = http.createServer(async (req, res) => {
    const sendJson = (statusCode: number, data: Record<string, unknown>) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    if (!checkAuth(req)) {
      sendJson(401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      sendJson(200, await handleHealth());
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }

    let body: unknown;
    try {
      body = await parseJsonBody(req);
    } catch {
      sendJson(400, { error: 'invalid_json' });
      return;
    }

    try {
      if (req.url === '/configure') {
        const result = handleConfigure(body);
        sendJson(result.status, result.body);
        return;
      }

      if (req.url === '/lead-bridge/bootstrap') {
        const parsed = LeadBridgeBootstrapRequest.safeParse(body);
        if (!parsed.success) {
          sendJson(400, {
            error: 'validation_error',
            details: parsed.error.issues,
          });
          return;
        }
        sendJson(200, bootstrapLeadBridge(parsed.data));
        return;
      }

      if (req.url === '/lead-bridge/inbound') {
        const parsed = LeadBridgeInboundRequest.safeParse(body);
        if (!parsed.success) {
          sendJson(400, {
            error: 'validation_error',
            details: parsed.error.issues,
          });
          return;
        }
        sendJson(200, ingestLeadBridgeInbound(parsed.data));
        return;
      }

      if (req.url === '/lead-bridge/outbound/claim') {
        const parsed = LeadBridgeClaimRequest.parse(body);
        sendJson(200, claimLeadBridgeOutbound(parsed.limit));
        return;
      }

      if (req.url === '/lead-bridge/outbound/ack') {
        const parsed = LeadBridgeAckRequest.safeParse(body);
        if (!parsed.success) {
          sendJson(400, {
            error: 'validation_error',
            details: parsed.error.issues,
          });
          return;
        }
        sendJson(
          200,
          ackLeadBridgeOutbound(parsed.data.leaseId, parsed.data.messageId),
        );
        return;
      }
    } catch (error) {
      logger.error({ err: error, url: req.url }, 'VM setup route failed');
      sendJson(500, { error: 'internal_error' });
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
