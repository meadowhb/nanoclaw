import { randomUUID } from 'node:crypto';
import { ChannelExecutor } from './channel-executor.js';
import { parseChannelMessage } from './channel-protocol.js';
import { formatChannelMessage } from './channel-protocol.js';
import type {
  AgentRequest,
  AgentResponse,
  ChannelEnvelope,
  PodFormation,
  PodResult,
  WorkerExecutor,
} from './orchestration-types.js';
import {
  AgentResponseSchema,
  PodFormationSchema,
} from './orchestration-types.js';
import type { ReleaseHandle } from './concurrency.js';
import type { LeadRegistry } from './lead-registry.js';

export interface ToolCallPayload {
  podId: string;
  tool: 'delegate_to_lead' | 'report_progress' | 'escalate_to_human';
  args: Record<string, unknown>;
}

export interface ToolResultPayload {
  podId: string;
  result: unknown;
  error?: string;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  payload: ToolCallPayload,
) => Promise<unknown> | unknown;

export interface HandleToolCallEnvelopeOptions {
  podId: string;
  envelope: ChannelEnvelope;
  channelJid: string;
  sendMessage: (jid: string, text: string) => Promise<void>;
  allowedToolCallers: Set<string>;
  handlers: Record<ToolCallPayload['tool'], ToolHandler>;
}

export interface OrchestratorEvent {
  podId: string;
  eventType:
    | 'lead_delegated'
    | 'lead_result'
    | 'lead_failed'
    | 'budget_check'
    | 'lead_retry'
    | 'lead_timeout'
    | 'escalation'
    | 'pod_started'
    | 'pod_completed'
    | 'pod_aborted';
  member?: string;
  attempt?: number;
  payload: Record<string, unknown>;
  rawResult?: unknown;
}

export type AppendEventFn = (
  db: unknown,
  dataDir: string,
  event: OrchestratorEvent,
) => Promise<void> | void;

export async function insertPodExecution(
  _db: unknown,
  _podId: string,
  _formationName: string,
): Promise<void> {}

export async function appendEvent(
  _db: unknown,
  _dataDir: string,
  _event: OrchestratorEvent,
): Promise<void> {}

export async function closePodExecution(
  _db: unknown,
  _podId: string,
  _podResult: PodResult,
): Promise<void> {}

export interface DelegateToLeadState {
  cumulative: number;
  maxTokens: number | null;
  budgetExceeded: boolean;
}

export interface DelegateToLeadHandlerOptions {
  podId: string;
  formationLeadIds: Set<string>;
  leadRegistry: LeadRegistry;
  pool: { engage(workerId: string, podId: string): Promise<ReleaseHandle> };
  executor: WorkerExecutor;
  db: unknown;
  dataDir: string;
  appendEvent: AppendEventFn;
  workspacePath: string;
  maxIterations: number;
  iterationCounts: Map<string, number>;
  idempotencyKeys: Map<string, string>;
  state: DelegateToLeadState;
}

export type OnMessage = (
  callback: (chatJid: string, text: string) => void,
) => () => void;

export interface HumanChannel {
  sendMessage(jid: string, text: string): Promise<void>;
  onMessage: OnMessage;
}

export interface TeamChannel {
  sendMessage(jid: string, text: string): Promise<void>;
  onMessage: OnMessage;
}

export interface RunTeamDeps {
  pool: {
    registerWorker(workerId: string, options?: { capacity?: number }): void;
    engage(workerId: string, podId: string): Promise<ReleaseHandle>;
  };
  db: unknown;
  dataDir: string;
  workspacePath: string;
  teamChannel: TeamChannel;
  humanChannel: HumanChannel;
  humanChatJid: string;
  leadRegistry: LeadRegistry;
  executor?: WorkerExecutor;
  insertPodExecutionFn?: typeof insertPodExecution;
  appendEventFn?: typeof appendEvent;
  closePodExecutionFn?: typeof closePodExecution;
}

export interface ReportProgressHandlerOptions {
  podId: string;
  visibility: 'low' | 'medium' | 'high';
  humanChannel: Pick<HumanChannel, 'sendMessage'>;
  humanChatJid: string;
}

export interface EscalateToHumanHandlerOptions {
  podId: string;
  humanChannel: HumanChannel;
  humanChatJid: string;
  db: unknown;
  dataDir: string;
  appendEvent: AppendEventFn;
  timeoutMs?: number;
}

interface DelegateToLeadArgs {
  leadId: string;
  objective: string;
  payload?: unknown;
  upstreamResults?: Record<string, unknown>;
  timeout?: number;
}

function parseDelegateToLeadArgs(
  args: Record<string, unknown>,
): DelegateToLeadArgs | null {
  if (typeof args.leadId !== 'string' || typeof args.objective !== 'string') {
    return null;
  }

  const timeout = args.timeout;
  if (timeout !== undefined && (typeof timeout !== 'number' || timeout <= 0)) {
    return null;
  }

  const upstreamResults = args.upstreamResults;
  if (
    upstreamResults !== undefined &&
    (typeof upstreamResults !== 'object' ||
      upstreamResults === null ||
      Array.isArray(upstreamResults))
  ) {
    return null;
  }

  return {
    leadId: args.leadId,
    objective: args.objective,
    payload: args.payload,
    upstreamResults: upstreamResults as Record<string, unknown> | undefined,
    timeout,
  };
}

function requestIdempotencyKey(
  map: Map<string, string>,
  leadId: string,
  objective: string,
): string {
  const key = `${leadId}::${objective}`;
  const existing = map.get(key);
  if (existing) {
    return existing;
  }

  const created = randomUUID();
  map.set(key, created);
  return created;
}

function estimatePayloadBytes(payload: unknown): number {
  try {
    const serialized = JSON.stringify(payload);
    return typeof serialized === 'string' ? serialized.length : 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function dispatchLeadRequest(
  executor: WorkerExecutor,
  leadId: string,
  request: AgentRequest,
  channelJid: string,
): Promise<AgentResponse> {
  return executor.sendWork(leadId, request, channelJid);
}

export function createDelegateToLeadHandler(
  options: DelegateToLeadHandlerOptions,
): ToolHandler {
  const {
    podId,
    formationLeadIds,
    leadRegistry,
    pool,
    executor,
    db,
    dataDir,
    appendEvent,
    workspacePath,
    maxIterations,
    iterationCounts,
    idempotencyKeys,
    state,
  } = options;

  return async (args: Record<string, unknown>): Promise<ToolResultPayload> => {
    const parsedArgs = parseDelegateToLeadArgs(args);
    if (!parsedArgs) {
      return { podId, result: null, error: 'Invalid delegate_to_lead args' };
    }

    if (!formationLeadIds.has(parsedArgs.leadId)) {
      return {
        podId,
        result: null,
        error: `Lead ${parsedArgs.leadId} is not in this formation`,
      };
    }

    const leadSpec = leadRegistry.get(parsedArgs.leadId);
    if (!leadSpec) {
      return {
        podId,
        result: null,
        error: `Unknown lead: ${parsedArgs.leadId}`,
      };
    }

    if (state.budgetExceeded) {
      return {
        podId,
        result: null,
        error: 'Budget exceeded — synthesize with available results',
      };
    }

    const currentIterations = iterationCounts.get(parsedArgs.leadId) ?? 0;
    if (currentIterations >= maxIterations) {
      return {
        podId,
        result: null,
        error: `Max iterations reached for ${parsedArgs.leadId}`,
      };
    }

    if (estimatePayloadBytes(parsedArgs.payload) > 2_097_152) {
      return { podId, result: null, error: 'Input too large' };
    }

    iterationCounts.set(parsedArgs.leadId, currentIterations + 1);

    let releaseHandle: ReleaseHandle | null = null;
    try {
      releaseHandle = await pool.engage(parsedArgs.leadId, podId);
      const idempotencyKey = requestIdempotencyKey(
        idempotencyKeys,
        parsedArgs.leadId,
        parsedArgs.objective,
      );
      const timeout = parsedArgs.timeout ?? leadSpec.defaultTimeout;

      await appendEvent(db, dataDir, {
        podId,
        eventType: 'lead_delegated',
        member: parsedArgs.leadId,
        attempt: 1,
        payload: { objective: parsedArgs.objective, channel: leadSpec.channel },
      });

      let response = await dispatchLeadRequest(
        executor,
        parsedArgs.leadId,
        {
          schemaVersion: 1,
          requestId: randomUUID(),
          idempotencyKey,
          attempt: 1,
          podId,
          objective: parsedArgs.objective,
          payload: parsedArgs.payload,
          upstreamResults: parsedArgs.upstreamResults,
          workspacePath,
          timeout,
        },
        leadSpec.channel,
      );

      await appendEvent(db, dataDir, {
        podId,
        eventType:
          response.status === 'success' ? 'lead_result' : 'lead_failed',
        member: parsedArgs.leadId,
        attempt: 1,
        payload: {
          objective: parsedArgs.objective,
          workerTrace: response.workerTrace,
        },
        rawResult: response,
      });

      if (response.status === 'error') {
        await appendEvent(db, dataDir, {
          podId,
          eventType: 'lead_retry',
          member: parsedArgs.leadId,
          attempt: 2,
          payload: { objective: parsedArgs.objective },
        });

        response = await dispatchLeadRequest(
          executor,
          parsedArgs.leadId,
          {
            schemaVersion: 1,
            requestId: randomUUID(),
            idempotencyKey,
            attempt: 2,
            podId,
            objective: parsedArgs.objective,
            payload: parsedArgs.payload,
            upstreamResults: parsedArgs.upstreamResults,
            workspacePath,
            timeout,
          },
          leadSpec.channel,
        );

        await appendEvent(db, dataDir, {
          podId,
          eventType:
            response.status === 'success' ? 'lead_result' : 'lead_failed',
          member: parsedArgs.leadId,
          attempt: 2,
          payload: {
            objective: parsedArgs.objective,
            workerTrace: response.workerTrace,
          },
          rawResult: response,
        });

        if (response.status === 'error' && response.error === 'timeout') {
          await appendEvent(db, dataDir, {
            podId,
            eventType: 'lead_timeout',
            member: parsedArgs.leadId,
            attempt: 2,
            payload: { objective: parsedArgs.objective },
          });
        }
      }

      const memberTokens =
        response.tokensUsed.input + response.tokensUsed.output;
      state.cumulative += memberTokens;
      const exceeded =
        state.maxTokens !== null && state.cumulative > state.maxTokens;
      await appendEvent(db, dataDir, {
        podId,
        eventType: 'budget_check',
        payload: {
          member: parsedArgs.leadId,
          memberTokens,
          cumulative: state.cumulative,
          maxTokens: state.maxTokens,
          exceeded,
        },
      });
      if (exceeded) {
        state.budgetExceeded = true;
      }

      return { podId, result: response };
    } catch (error) {
      return {
        podId,
        result: null,
        error:
          error instanceof Error ? error.message : 'Failed to delegate to lead',
      };
    } finally {
      if (releaseHandle) {
        releaseHandle();
      }
    }
  };
}

interface ReportProgressArgs {
  text: string;
}

function parseReportProgressArgs(
  args: Record<string, unknown>,
): ReportProgressArgs | null {
  const text =
    typeof args.text === 'string'
      ? args.text
      : typeof args.message === 'string'
        ? args.message
        : null;
  if (!text) {
    return null;
  }
  return { text };
}

export function createReportProgressHandler(
  options: ReportProgressHandlerOptions,
): ToolHandler {
  const { podId, visibility, humanChannel, humanChatJid } = options;
  return async (args: Record<string, unknown>): Promise<ToolResultPayload> => {
    const parsedArgs = parseReportProgressArgs(args);
    if (!parsedArgs) {
      return { podId, result: null, error: 'Invalid report_progress args' };
    }

    if (visibility === 'low') {
      return {
        podId,
        result: { sent: false, reason: 'visibility_low' },
      };
    }

    await humanChannel.sendMessage(humanChatJid, parsedArgs.text);
    return { podId, result: { sent: true } };
  };
}

interface EscalateToHumanArgs {
  question: string;
  context: unknown;
}

function parseEscalateArgs(
  args: Record<string, unknown>,
): EscalateToHumanArgs | null {
  if (typeof args.question !== 'string' || args.question.trim().length === 0) {
    return null;
  }
  return {
    question: args.question,
    context: args.context,
  };
}

async function waitForHumanReply(
  humanChannel: HumanChannel,
  humanChatJid: string,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      if (unsubscribe) {
        unsubscribe();
      }
      resolve(value);
    };

    const timeoutId = setTimeout(() => finish(null), timeoutMs);
    unsubscribe = humanChannel.onMessage((chatJid, text) => {
      if (chatJid !== humanChatJid) {
        return;
      }
      if (parseChannelMessage(text)) {
        return;
      }
      if (text.trim().length === 0) {
        return;
      }
      finish(text);
    });
  });
}

export function createEscalateToHumanHandler(
  options: EscalateToHumanHandlerOptions,
): ToolHandler {
  const {
    podId,
    humanChannel,
    humanChatJid,
    db,
    dataDir,
    appendEvent,
    timeoutMs = 300_000,
  } = options;

  return async (args: Record<string, unknown>): Promise<ToolResultPayload> => {
    const parsedArgs = parseEscalateArgs(args);
    if (!parsedArgs) {
      return { podId, result: null, error: 'Invalid escalate_to_human args' };
    }

    const message = `Escalation from Chief of Staff:\n${parsedArgs.question}`;
    await humanChannel.sendMessage(humanChatJid, message);
    await appendEvent(db, dataDir, {
      podId,
      eventType: 'escalation',
      payload: {
        question: parsedArgs.question,
        context: parsedArgs.context,
      },
    });

    const response = await waitForHumanReply(
      humanChannel,
      humanChatJid,
      timeoutMs,
    );
    if (response === null) {
      return { podId, result: null, error: 'No response from human (timeout)' };
    }
    return { podId, result: response };
  };
}

function buildCosPrompt(
  formation: PodFormation,
  leadRegistry: LeadRegistry,
): string {
  const roster = formation.leads
    .map((leadId) => {
      const lead = leadRegistry.get(leadId);
      if (!lead) {
        return `- ${leadId} | unresolved lead (cannot delegate)`;
      }
      const soulSummary = lead.soul.slice(0, 200);
      return `- ${lead.leadId} | team: ${lead.team} | model: ${lead.model} | channel: ${lead.channel} | soul: ${soulSummary}`;
    })
    .join('\n');

  const budgetText =
    formation.budget?.maxTokens != null
      ? `${formation.budget.maxTokens}`
      : 'not set';
  const maxIterationsText = `${formation.max_iterations ?? 3}`;
  const visibilityText = formation.visibility ?? 'medium';

  return [
    'You are the Chief of Staff — a long-lived team member, always present in the chat. Decompose objectives, delegate scoped objectives to functional leads, evaluate cross-functional synthesis, escalate to the human (CEO) when uncertain.',
    '',
    'Lead roster:',
    roster,
    '',
    "Delegate to functional leads only. Leads coordinate their own internal workers. You evaluate the leads' output, not worker-level traces.",
    '',
    `Constraints: budget=${budgetText}, max_iterations=${maxIterationsText}, timeout=${formation.timeout}, visibility=${visibilityText}`,
    '',
    'You have 3 tools: `delegate_to_lead` to delegate work, `report_progress` to update the human, `escalate_to_human` to ask the human a question. Synthesize lead results yourself — compare, merge, and resolve conflicts in your own reasoning rather than delegating synthesis.',
    '',
    'Rules: leads always retry once on error; when budget exceeded stop assigning and synthesize; when all leads fail report failure; call `report_progress` at meaningful milestones only.',
    '',
    'The human (CEO) may message you or any lead directly at any time. Respond naturally — you are a team member, not a background process.',
  ].join('\n');
}

function waitForCosResponse(options: {
  podId: string;
  requestId: string;
  timeoutSeconds: number;
  teamChannel: TeamChannel;
  channelJid: string;
  allowedToolCallers: Set<string>;
  handlers: Record<ToolCallPayload['tool'], ToolHandler>;
}): Promise<AgentResponse | null> {
  const {
    podId,
    requestId,
    timeoutSeconds,
    teamChannel,
    channelJid,
    allowedToolCallers,
    handlers,
  } = options;

  return new Promise<AgentResponse | null>((resolve) => {
    let settled = false;
    const finish = (value: AgentResponse | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      unsubscribe();
      resolve(value);
    };

    const unsubscribe = teamChannel.onMessage(async (chatJid, text) => {
      if (chatJid !== channelJid || settled) {
        return;
      }

      const envelope = parseChannelMessage(text);
      if (!envelope) {
        return;
      }

      if (envelope.type === 'tool_call') {
        await handleToolCallEnvelope({
          podId,
          envelope,
          channelJid,
          sendMessage: teamChannel.sendMessage,
          allowedToolCallers,
          handlers,
        });
        return;
      }

      if (
        envelope.type === 'work_response' &&
        envelope.requestId === requestId
      ) {
        const parsed = AgentResponseSchema.safeParse(envelope.payload);
        if (parsed.success) {
          finish(parsed.data as AgentResponse);
          return;
        }
        finish({
          schemaVersion: 1,
          requestId,
          status: 'error',
          error: 'invalid_response',
          durationMs: 0,
          tokensUsed: { input: 0, output: 0 },
        });
      }
    });

    const timeoutId = setTimeout(
      () => finish(null),
      Math.max(1, timeoutSeconds * 1000),
    );
  });
}

export async function runTeam(
  formation: PodFormation,
  deps: RunTeamDeps,
): Promise<PodResult> {
  const parsedFormation = PodFormationSchema.safeParse(formation);
  if (!parsedFormation.success) {
    return {
      podId: randomUUID(),
      formation: formation.name,
      status: 'failed',
      result: null,
      error: {
        code: 'invalid_formation',
        message: parsedFormation.error.message,
      },
      memberResults: {},
      artifacts: [],
      durationMs: 0,
      tokensUsed: { input: 0, output: 0 },
    };
  }

  const validFormation = parsedFormation.data;
  const insertPodExecutionFn = deps.insertPodExecutionFn ?? insertPodExecution;
  const appendEventFn = deps.appendEventFn ?? appendEvent;
  const closePodExecutionFn = deps.closePodExecutionFn ?? closePodExecution;

  const unresolvedLeads = validFormation.leads.filter(
    (leadId) => !deps.leadRegistry.get(leadId),
  );
  if (unresolvedLeads.length > 0) {
    return {
      podId: randomUUID(),
      formation: validFormation.name,
      status: 'failed',
      result: null,
      error: {
        code: 'invalid_formation',
        message: `Unknown lead IDs in formation: ${unresolvedLeads.join(', ')}`,
      },
      memberResults: {},
      artifacts: [],
      durationMs: 0,
      tokensUsed: { input: 0, output: 0 },
    };
  }

  const coordinatorSpec = deps.leadRegistry.get(validFormation.coordinatorId);
  if (!coordinatorSpec) {
    return {
      podId: randomUUID(),
      formation: validFormation.name,
      status: 'failed',
      result: null,
      error: {
        code: 'invalid_coordinator',
        message: `Coordinator lead not found in registry: ${validFormation.coordinatorId}`,
      },
      memberResults: {},
      artifacts: [],
      durationMs: 0,
      tokensUsed: { input: 0, output: 0 },
    };
  }

  let executor: WorkerExecutor | null = null;
  let podId: string | null = null;
  let startedAt = 0;

  try {
    podId = randomUUID();
    startedAt = Date.now();

    await insertPodExecutionFn(deps.db, podId, validFormation.name);
    await appendEventFn(deps.db, deps.dataDir, {
      podId,
      eventType: 'pod_started',
      payload: {
        formation: validFormation.name,
        objective: validFormation.objective,
        leadCount: validFormation.leads.length,
      },
    });

    executor =
      deps.executor ??
      new ChannelExecutor(deps.teamChannel, deps.teamChannel.onMessage);

    for (const leadId of new Set(validFormation.leads)) {
      const lead = deps.leadRegistry.get(leadId);
      if (!lead) {
        continue;
      }
      deps.pool.registerWorker(leadId, {
        capacity: lead.maxConcurrentPods,
      });
    }

    const state: DelegateToLeadState = {
      cumulative: 0,
      maxTokens: validFormation.budget?.maxTokens ?? null,
      budgetExceeded: false,
    };
    const iterationCounts = new Map<string, number>();
    const idempotencyKeys = new Map<string, string>();
    const maxIterations = validFormation.max_iterations ?? 3;
    const memberResults: Record<string, AgentResponse> = {};
    const artifacts: string[] = [];

    const baseDelegateToLead = createDelegateToLeadHandler({
      podId,
      formationLeadIds: new Set(validFormation.leads),
      leadRegistry: deps.leadRegistry,
      pool: deps.pool,
      executor,
      db: deps.db,
      dataDir: deps.dataDir,
      appendEvent: appendEventFn,
      workspacePath: deps.workspacePath,
      maxIterations,
      iterationCounts,
      idempotencyKeys,
      state,
    });

    const handlers: Record<ToolCallPayload['tool'], ToolHandler> = {
      delegate_to_lead: async (
        args: Record<string, unknown>,
        payload: ToolCallPayload,
      ): Promise<ToolResultPayload> => {
        const result = (await baseDelegateToLead(
          args,
          payload,
        )) as ToolResultPayload;
        const leadId = typeof args.leadId === 'string' ? args.leadId : null;
        const parsed = AgentResponseSchema.safeParse(result.result);
        if (leadId && parsed.success) {
          memberResults[leadId] = parsed.data as AgentResponse;
          if (Array.isArray(parsed.data.artifacts)) {
            artifacts.push(...parsed.data.artifacts);
          }
        }
        return result;
      },
      report_progress: createReportProgressHandler({
        podId,
        visibility: validFormation.visibility ?? 'medium',
        humanChannel: deps.humanChannel,
        humanChatJid: deps.humanChatJid,
      }),
      escalate_to_human: createEscalateToHumanHandler({
        podId,
        humanChannel: deps.humanChannel,
        humanChatJid: deps.humanChatJid,
        db: deps.db,
        dataDir: deps.dataDir,
        appendEvent: appendEventFn,
      }),
    };

    const requestId = randomUUID();
    const cosRequest: AgentRequest = {
      schemaVersion: 1,
      requestId,
      idempotencyKey: randomUUID(),
      attempt: 1,
      podId,
      objective: validFormation.objective,
      payload: { cosPrompt: buildCosPrompt(validFormation, deps.leadRegistry) },
      workspacePath: deps.workspacePath,
      timeout: validFormation.timeout,
    };
    const workRequestEnvelope: ChannelEnvelope = {
      schemaVersion: 1,
      type: 'work_request',
      requestId,
      senderId: 'orchestrator',
      timestamp: Date.now(),
      payload: cosRequest,
    };

    await deps.teamChannel.sendMessage(
      coordinatorSpec.channel,
      formatChannelMessage(workRequestEnvelope),
    );

    const cosResponse = await waitForCosResponse({
      podId,
      requestId,
      timeoutSeconds: validFormation.timeout,
      teamChannel: deps.teamChannel,
      channelJid: coordinatorSpec.channel,
      allowedToolCallers: new Set([
        validFormation.coordinatorId,
        ...validFormation.leads,
      ]),
      handlers,
    });

    const podResult: PodResult = !cosResponse
      ? {
          podId,
          formation: validFormation.name,
          status: 'timed_out',
          result: null,
          error: { code: 'timeout', message: 'Formation timeout exceeded' },
          memberResults,
          artifacts,
          durationMs: Date.now() - startedAt,
          tokensUsed: { input: 0, output: state.cumulative },
        }
      : {
          podId,
          formation: validFormation.name,
          status: cosResponse.status === 'success' ? 'succeeded' : 'failed',
          result: cosResponse.result,
          error:
            cosResponse.status === 'error'
              ? { code: 'cos_error', message: cosResponse.error }
              : undefined,
          memberResults,
          artifacts,
          durationMs: Date.now() - startedAt,
          tokensUsed: { input: 0, output: state.cumulative },
        };

    await closePodExecutionFn(deps.db, podId, podResult);
    await appendEventFn(deps.db, deps.dataDir, {
      podId,
      eventType:
        podResult.status === 'timed_out' || podResult.status === 'aborted'
          ? 'pod_aborted'
          : 'pod_completed',
      payload: { status: podResult.status, durationMs: podResult.durationMs },
    });

    return podResult;
  } catch (error) {
    return {
      podId: podId ?? randomUUID(),
      formation: validFormation.name,
      status: 'failed',
      result: null,
      error: {
        code: 'internal_error',
        message: error instanceof Error ? error.message : String(error),
      },
      memberResults: {},
      artifacts: [],
      durationMs: startedAt > 0 ? Date.now() - startedAt : 0,
      tokensUsed: { input: 0, output: 0 },
    };
  } finally {
    if (executor) {
      await executor.dispose();
    }
  }
}

function parseToolCallPayload(payload: unknown): ToolCallPayload | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const podId = candidate.podId;
  const tool = candidate.tool;
  const args = candidate.args;
  if (typeof podId !== 'string') {
    return null;
  }
  if (
    tool !== 'delegate_to_lead' &&
    tool !== 'report_progress' &&
    tool !== 'escalate_to_human'
  ) {
    return null;
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return null;
  }

  return {
    podId,
    tool,
    args: args as Record<string, unknown>,
  };
}

export async function handleToolCallEnvelope(
  options: HandleToolCallEnvelopeOptions,
): Promise<boolean> {
  const {
    podId,
    envelope,
    channelJid,
    sendMessage,
    allowedToolCallers,
    handlers,
  } = options;

  if (envelope.type !== 'tool_call') {
    return false;
  }
  if (!allowedToolCallers.has(envelope.senderId)) {
    return false;
  }

  const payload = parseToolCallPayload(envelope.payload);
  if (!payload) {
    return false;
  }
  if (payload.podId !== podId) {
    return false;
  }

  let toolResultPayload: ToolResultPayload;
  try {
    const result = await handlers[payload.tool](payload.args, payload);
    toolResultPayload = {
      podId,
      result,
    };
  } catch (error) {
    toolResultPayload = {
      podId,
      result: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  const resultEnvelope: ChannelEnvelope = {
    schemaVersion: 1,
    type: 'tool_result',
    requestId: envelope.requestId,
    senderId: 'orchestrator',
    timestamp: Date.now(),
    payload: toolResultPayload,
  };
  await sendMessage(channelJid, formatChannelMessage(resultEnvelope));
  return true;
}
