import { z } from 'zod';

const kebabCaseRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface AgentRequest {
  schemaVersion: 1;
  requestId: string;
  idempotencyKey: string;
  attempt: number;
  podId: string;
  objective: string;
  payload: unknown;
  upstreamResults?: Record<string, unknown>;
  workspacePath: string;
  timeout: number;
}

export interface AgentResponseBase {
  schemaVersion: 1;
  requestId: string;
  durationMs: number;
  tokensUsed: { input: number; output: number };
  artifacts?: string[];
  workerTrace?: Array<{
    name: string;
    status: 'success' | 'error';
    durationMs: number;
    tokensUsed: { input: number; output: number };
  }>;
}

export interface AgentResponseSuccess extends AgentResponseBase {
  status: 'success';
  result: unknown;
}

export interface AgentResponseError extends AgentResponseBase {
  status: 'error';
  error: string;
  result?: unknown;
}

export type AgentResponse = AgentResponseSuccess | AgentResponseError;

export type FunctionalTeam =
  | 'engineering'
  | 'support'
  | 'legal'
  | 'marketing'
  | 'ops'
  | 'sales'
  | 'product'
  | 'cos';

export type ExecutionMode = 'containerized' | 'in_process';

export interface LeadRuntimePolicy {
  executionMode: ExecutionMode;
  allowedTools: string[];
}

export interface LeadBlueprint {
  leadId: string;
  team: FunctionalTeam;
  soul: string;
  model: 'haiku' | 'sonnet' | 'opus';
  channel: string;
  maxConcurrentPods: number;
  defaultTimeout: number;
  runtime?: LeadRuntimePolicy;
}

export type LeadSpec = LeadBlueprint;

export interface LeadInstance {
  leadId: string;
  blueprint: LeadBlueprint;
  rootDir: string;
  workspaceDir: string;
  claudeDir: string;
  claudeMdPath: string;
  managedHashPath: string;
  settingsPath: string;
  bridgeGroupFolder: string;
}

export interface AgentSpec {
  name: string;
  role: 'lead' | 'member';
  prompt: string;
  model: 'haiku' | 'sonnet' | 'opus';
  timeout: number;
  mode: 'single_turn' | 'multi_turn';
  side_effects: 'none' | 'workspace_only' | 'external_write';
  soul: string;
  identity: {
    group: string;
    credentials?: Record<string, string>;
  };
}

export interface PodFormation {
  name: string;
  objective: string;
  leads: string[];
  coordinatorId: string;
  allowedWorkerIdentityIds?: string[];
  aggregation?: 'merge' | 'first_success' | 'summarize';
  timeout: number;
  max_iterations?: number;
  budget?: { maxTokens: number };
  visibility?: 'low' | 'medium' | 'high';
}

export interface PodResult {
  podId: string;
  formation: string;
  status: 'succeeded' | 'failed' | 'timed_out' | 'aborted';
  result: unknown;
  error?: { code: string; message: string };
  memberResults: Record<string, AgentResponse>;
  artifacts: string[];
  durationMs: number;
  tokensUsed: { input: number; output: number };
}

export interface WorkerExecutor {
  sendWork(
    workerId: string,
    request: AgentRequest,
    channelJid: string,
  ): Promise<AgentResponse>;
  getPresence(workerId: string): Promise<'online' | 'offline' | 'busy'>;
  dispose(): Promise<void>;
}

export type ChannelMessageType =
  | 'work_request'
  | 'work_response'
  | 'heartbeat'
  | 'presence_query'
  | 'tool_call'
  | 'tool_result';

export interface ChannelEnvelope {
  schemaVersion: 1;
  type: ChannelMessageType;
  requestId: string;
  senderId: string;
  timestamp: number;
  payload: unknown;
}

export type EventType =
  | 'pod_started'
  | 'lead_delegated'
  | 'lead_result'
  | 'lead_retry'
  | 'lead_failed'
  | 'lead_timeout'
  | 'decision_made'
  | 'budget_check'
  | 'escalation'
  | 'pod_completed'
  | 'pod_aborted';

export interface PodEvent {
  podId: string;
  eventType: EventType;
  member?: string;
  attempt?: number;
  payload: Record<string, unknown>;
  rawResult?: unknown;
}

export const AgentRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    attempt: z.number().int().min(1),
    podId: z.string().min(1),
    objective: z.string().min(1),
    payload: z.unknown(),
    upstreamResults: z.record(z.string(), z.unknown()).optional(),
    workspacePath: z.string().min(1),
    timeout: z.number().positive(),
  })
  .strict();

const responseBaseShape = {
  schemaVersion: z.literal(1),
  requestId: z.string().uuid(),
  durationMs: z.number().min(0),
  tokensUsed: z
    .object({
      input: z.number().min(0),
      output: z.number().min(0),
    })
    .strict(),
  artifacts: z.array(z.string()).optional(),
  workerTrace: z
    .array(
      z
        .object({
          name: z.string().min(1),
          status: z.enum(['success', 'error']),
          durationMs: z.number().min(0),
          tokensUsed: z
            .object({
              input: z.number().min(0),
              output: z.number().min(0),
            })
            .strict(),
        })
        .strict(),
    )
    .optional(),
};

const AgentResponseSuccessSchema = z
  .object({
    ...responseBaseShape,
    status: z.literal('success'),
    result: z.unknown(),
  })
  .strict();

const AgentResponseErrorSchema = z
  .object({
    ...responseBaseShape,
    status: z.literal('error'),
    error: z.string().min(1),
    result: z.unknown().optional(),
  })
  .strict();

export const AgentResponseSchema = z.discriminatedUnion('status', [
  AgentResponseSuccessSchema,
  AgentResponseErrorSchema,
]);

export const ExecutionModeSchema = z.enum(['containerized', 'in_process']);

export const LeadRuntimePolicySchema = z
  .object({
    executionMode: ExecutionModeSchema,
    allowedTools: z.array(z.string().min(1)),
  })
  .strict();

export const LeadSpecSchema = z
  .object({
    leadId: z.string().regex(kebabCaseRegex),
    team: z.enum([
      'engineering',
      'support',
      'legal',
      'marketing',
      'ops',
      'sales',
      'product',
      'cos',
    ]),
    soul: z.string().min(1),
    model: z.enum(['haiku', 'sonnet', 'opus']),
    channel: z.string().min(1),
    maxConcurrentPods: z.number().int().min(1),
    defaultTimeout: z.number().positive(),
    runtime: LeadRuntimePolicySchema.optional(),
  })
  .strict();

export const LeadBlueprintSchema = LeadSpecSchema;

export const AgentSpecSchema = z
  .object({
    name: z.string().regex(kebabCaseRegex),
    role: z.enum(['lead', 'member']),
    prompt: z.string().min(1),
    model: z.enum(['haiku', 'sonnet', 'opus']),
    timeout: z.number().positive(),
    mode: z.enum(['single_turn', 'multi_turn']),
    side_effects: z.enum(['none', 'workspace_only', 'external_write']),
    soul: z.string().min(1),
    identity: z
      .object({
        group: z.string().regex(kebabCaseRegex),
        credentials: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
  })
  .strict();

export const PodFormationSchema = z
  .object({
    name: z.string().min(1),
    objective: z.string().min(1),
    leads: z.array(z.string().regex(kebabCaseRegex)).min(1),
    coordinatorId: z.string().regex(kebabCaseRegex),
    allowedWorkerIdentityIds: z
      .array(z.string().regex(kebabCaseRegex))
      .optional(),
    aggregation: z.enum(['merge', 'first_success', 'summarize']).optional(),
    timeout: z.number().positive(),
    max_iterations: z.number().int().min(1).optional(),
    budget: z
      .object({
        maxTokens: z.number().positive(),
      })
      .strict()
      .optional(),
    visibility: z.enum(['low', 'medium', 'high']).default('medium'),
  })
  .strict();

export const ChannelEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.enum([
      'work_request',
      'work_response',
      'heartbeat',
      'presence_query',
      'tool_call',
      'tool_result',
    ]),
    requestId: z.string().uuid(),
    senderId: z.string().min(1),
    timestamp: z.number().positive(),
    payload: z.unknown(),
  })
  .strict();
