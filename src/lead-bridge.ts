import { randomUUID } from 'node:crypto';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, GROUPS_DIR } from './config.js';
import {
  getGatewayThread,
  getRegisteredGroup,
  setGatewayThread,
  setRegisteredGroup,
  storeChatMetadata,
  storeMessageDirect,
} from './db.js';
import { isValidGroupFolder } from './group-folder.js';

const LEASE_TTL_MS = 30_000;
const LEAD_BRIDGE_DIR = path.join(DATA_DIR, 'lead-bridge');
const TEMPLATE_DIR = path.join(LEAD_BRIDGE_DIR, 'templates');
const CONFIG_PATH = path.join(LEAD_BRIDGE_DIR, 'config.json');
const OUTBOX_PENDING_DIR = path.join(LEAD_BRIDGE_DIR, 'outbox', 'pending');
const OUTBOX_LEASED_DIR = path.join(LEAD_BRIDGE_DIR, 'outbox', 'leased');

interface LeadBridgeLeadConfig {
  leadId: string;
  channelJid: string;
  folderSlug: string;
  soul: string;
}

interface LeadBridgeWorkspaceConfig {
  teamId: string;
  workspaceId: string;
  leads: LeadBridgeLeadConfig[];
}

interface LeadBridgeConfigFile {
  workspaces: Record<string, LeadBridgeWorkspaceConfig>;
}

export interface LeadBridgeBootstrapRequest {
  teamId: string;
  workspaceId: string;
  leads: LeadBridgeLeadConfig[];
}

export interface LeadBridgeInboundRequest {
  teamId: string;
  leadId: string;
  channelJid: string;
  threadJid: string;
  rootThreadTs: string;
  messageId: string;
  messageTs: string;
  senderId: string;
  senderName: string;
  text: string;
}

export interface LeadBridgeOutboundMessage {
  messageId: string;
  teamId: string;
  leadId: string;
  channelJid: string;
  threadJid: string;
  rootThreadTs: string;
  text: string;
}

function ensureLeadBridgeDirs(): void {
  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  fs.mkdirSync(OUTBOX_PENDING_DIR, { recursive: true });
  fs.mkdirSync(OUTBOX_LEASED_DIR, { recursive: true });
}

function readLeadBridgeConfig(): LeadBridgeConfigFile {
  ensureLeadBridgeDirs();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as LeadBridgeConfigFile;
    if (parsed && typeof parsed === 'object' && parsed.workspaces) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return { workspaces: {} };
}

function writeLeadBridgeConfig(config: LeadBridgeConfigFile): void {
  ensureLeadBridgeDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function buildLeadTemplateMarkdown(lead: LeadBridgeLeadConfig): string {
  return [
    `# ${lead.leadId}`,
    '',
    lead.soul.trim(),
    '',
    'You are responding inside a Slack lead thread.',
    'Keep answers concise, practical, and directly useful to the human in the thread.',
  ].join('\n');
}

function writeLeadTemplate(
  workspaceId: string,
  lead: LeadBridgeLeadConfig,
): string {
  const leadDir = path.join(TEMPLATE_DIR, workspaceId, lead.leadId);
  fs.mkdirSync(leadDir, { recursive: true });
  const claudePath = path.join(leadDir, 'CLAUDE.md');
  fs.writeFileSync(claudePath, buildLeadTemplateMarkdown(lead));
  return claudePath;
}

function sanitizeThreadSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildThreadFolder(lead: LeadBridgeLeadConfig, rootThreadTs: string): string {
  const folder = `slk_${lead.folderSlug}_${sanitizeThreadSegment(rootThreadTs)}`;
  if (!isValidGroupFolder(folder)) {
    throw new Error(`Invalid thread folder generated for ${lead.leadId}`);
  }
  return folder;
}

function parseSlackChannelJid(
  jid: string,
): { teamId: string; channelId: string } | null {
  const parts = jid.split(':');
  if (parts.length !== 3 || parts[0] !== 'slack') {
    return null;
  }
  const teamId = parts[1]?.trim();
  const channelId = parts[2]?.trim();
  if (!teamId || !channelId) {
    return null;
  }
  return { teamId, channelId };
}

function getLeadConfigByChannelJid(
  channelJid: string,
): { workspaceId: string; lead: LeadBridgeLeadConfig } | null {
  const config = readLeadBridgeConfig();
  for (const workspace of Object.values(config.workspaces)) {
    const lead = workspace.leads.find((item) => item.channelJid === channelJid);
    if (lead) {
      return {
        workspaceId: workspace.workspaceId,
        lead,
      };
    }
  }
  return null;
}

export function bootstrapLeadBridge(
  request: LeadBridgeBootstrapRequest,
): { ok: true } {
  ensureLeadBridgeDirs();
  const config = readLeadBridgeConfig();
  config.workspaces[request.workspaceId] = {
    teamId: request.teamId,
    workspaceId: request.workspaceId,
    leads: request.leads.map((lead) => ({ ...lead })),
  };
  for (const lead of request.leads) {
    writeLeadTemplate(request.workspaceId, lead);
  }
  writeLeadBridgeConfig(config);
  return { ok: true };
}

export function ingestLeadBridgeInbound(
  request: LeadBridgeInboundRequest,
): { ok: true } {
  ensureLeadBridgeDirs();
  const matched = getLeadConfigByChannelJid(request.channelJid);
  if (!matched || matched.lead.leadId !== request.leadId) {
    throw new Error(`Unknown lead bridge mapping for ${request.channelJid}`);
  }
  const { workspaceId, lead } = matched;
  const folder = buildThreadFolder(lead, request.rootThreadTs);
  const groupDir = path.join(GROUPS_DIR, folder);
  if (!getRegisteredGroup(request.threadJid)) {
    fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
    const templatePath = path.join(
      TEMPLATE_DIR,
      workspaceId,
      request.leadId,
      'CLAUDE.md',
    );
    if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, path.join(groupDir, 'CLAUDE.md'));
    } else {
      fs.writeFileSync(path.join(groupDir, 'CLAUDE.md'), buildLeadTemplateMarkdown(lead));
    }
    setRegisteredGroup(request.threadJid, {
      name: `${request.leadId} Slack Thread`,
      folder,
      trigger: '@',
      added_at: new Date().toISOString(),
      requiresTrigger: false,
    });
  }
  setGatewayThread(
    request.threadJid,
    request.leadId,
    request.channelJid,
    request.rootThreadTs,
  );
  storeChatMetadata(
    request.threadJid,
    request.messageTs,
    `${request.leadId} Slack Thread`,
    'gateway',
    true,
  );
  storeMessageDirect({
    id: request.messageId,
    chat_jid: request.threadJid,
    sender: request.senderId,
    sender_name: request.senderName,
    content: request.text,
    timestamp: request.messageTs,
    is_from_me: false,
    is_bot_message: false,
  });
  return { ok: true };
}

export function enqueueLeadBridgeOutbound(
  threadJid: string,
  text: string,
): { ok: true; messageId: string } {
  ensureLeadBridgeDirs();
  const thread = getGatewayThread(threadJid);
  if (!thread) {
    throw new Error(`Unknown gateway thread ${threadJid}`);
  }
  const parsed = parseSlackChannelJid(thread.channel_jid);
  if (!parsed) {
    throw new Error(`Invalid Slack channel JID ${thread.channel_jid}`);
  }
  const messageId = randomUUID();
  const payload: LeadBridgeOutboundMessage = {
    messageId,
    teamId: parsed.teamId,
    leadId: thread.lead_id,
    channelJid: thread.channel_jid,
    threadJid,
    rootThreadTs: thread.root_thread_ts,
    text,
  };
  fs.writeFileSync(
    path.join(OUTBOX_PENDING_DIR, `${messageId}.json`),
    JSON.stringify(payload, null, 2),
  );
  return { ok: true, messageId };
}

function recoverExpiredLeases(nowMs: number): void {
  ensureLeadBridgeDirs();
  for (const filename of fs.readdirSync(OUTBOX_LEASED_DIR)) {
    const leasedPath = path.join(OUTBOX_LEASED_DIR, filename);
    const stat = fs.statSync(leasedPath);
    if (nowMs - stat.mtimeMs <= LEASE_TTL_MS) {
      continue;
    }
    const [, messageId] = filename.split('__');
    if (!messageId) {
      continue;
    }
    fs.renameSync(leasedPath, path.join(OUTBOX_PENDING_DIR, messageId));
  }
}

export function claimLeadBridgeOutbound(
  limit: number = 10,
): {
  messages: Array<LeadBridgeOutboundMessage & { leaseId: string }>;
} {
  ensureLeadBridgeDirs();
  recoverExpiredLeases(Date.now());
  const filenames = fs
    .readdirSync(OUTBOX_PENDING_DIR)
    .filter((filename) => filename.endsWith('.json'))
    .sort()
    .slice(0, Math.max(0, limit));
  const messages: Array<LeadBridgeOutboundMessage & { leaseId: string }> = [];

  for (const filename of filenames) {
    const messageId = filename.replace(/\.json$/u, '');
    const leaseId = randomUUID();
    const pendingPath = path.join(OUTBOX_PENDING_DIR, filename);
    const leasedPath = path.join(OUTBOX_LEASED_DIR, `${leaseId}__${filename}`);
    fs.renameSync(pendingPath, leasedPath);
    const payload = JSON.parse(
      fs.readFileSync(leasedPath, 'utf8'),
    ) as LeadBridgeOutboundMessage;
    messages.push({
      ...payload,
      messageId,
      leaseId,
    });
  }

  return { messages };
}

export function ackLeadBridgeOutbound(
  leaseId: string,
  messageId: string,
): { ok: true } {
  ensureLeadBridgeDirs();
  const leasedPath = path.join(OUTBOX_LEASED_DIR, `${leaseId}__${messageId}.json`);
  if (fs.existsSync(leasedPath)) {
    fs.unlinkSync(leasedPath);
  }
  return { ok: true };
}
