import type { ServerResponse } from 'node:http';

import { z } from 'zod';

import { DATA_DIR } from './config.js';
import { WorkerPool } from './concurrency.js';
import {
  createLeadRegistry,
  DEFAULT_COS,
  DEFAULT_LEADS,
} from './lead-registry.js';
import {
  runTeam,
  type OrchestratorEvent,
  type RunTeamDeps,
} from './orchestrator.js';
import {
  PodFormationSchema,
  type LeadSpec,
  type PodFormation,
  type PodResult,
} from './orchestration-types.js';

const LeadOverrideSchema = z
  .object({
    soul: z.string().min(1).optional(),
    model: z.enum(['haiku', 'sonnet', 'opus']).optional(),
  })
  .strict();

export const OrchestrationRequestSchema = z
  .object({
    formation: PodFormationSchema,
    leadOverrides: z.record(z.string(), LeadOverrideSchema).optional(),
    humanChatJid: z.string().min(1),
    timeout: z.number().positive(),
  })
  .strict();

export type OrchestrationRequest = z.infer<typeof OrchestrationRequestSchema>;

export interface OrchestrationStreamEvent {
  event:
    | 'pod_started'
    | 'lead_delegated'
    | 'lead_result'
    | 'progress'
    | 'escalation'
    | 'pod_completed'
    | 'error'
    | 'timeout';
  data: unknown;
}

export interface OrchestrationApiOptions {
  createRunTeamDeps?: (args: {
    request: OrchestrationRequest;
    formation: PodFormation;
    leadRegistry: ReturnType<typeof createLeadRegistry>;
  }) => RunTeamDeps;
  runTeamFn?: typeof runTeam;
}

type SseResponse = {
  writeHead: (statusCode: number, headers: Record<string, string>) => void;
  write: (chunk: string) => boolean | void;
  end: (chunk?: string) => void;
};

function applyLeadOverrides(
  leads: LeadSpec[],
  overrides?: Record<string, Partial<Pick<LeadSpec, 'soul' | 'model'>>>,
): LeadSpec[] {
  if (!overrides) {
    return leads;
  }

  return leads.map((lead) => {
    const override = overrides[lead.leadId];
    if (!override) {
      return lead;
    }

    return {
      ...lead,
      soul: override.soul ?? lead.soul,
      model: override.model ?? lead.model,
    };
  });
}

function createNoopChannel(): Pick<
  RunTeamDeps['teamChannel'],
  'sendMessage' | 'onMessage'
> {
  return {
    sendMessage: async () => undefined,
    onMessage: () => () => undefined,
  };
}

function mapEventType(
  event: OrchestratorEvent,
): OrchestrationStreamEvent['event'] | null {
  switch (event.eventType) {
    case 'pod_started':
      return 'pod_started';
    case 'lead_delegated':
      return 'lead_delegated';
    case 'lead_result':
      return 'lead_result';
    case 'budget_check':
    case 'lead_retry':
      return 'progress';
    case 'escalation':
      return 'escalation';
    case 'pod_completed':
      return 'pod_completed';
    case 'lead_timeout':
      return 'timeout';
    case 'lead_failed':
    case 'pod_aborted':
      return 'error';
    default:
      return null;
  }
}

export function formatSseEvent(
  event: OrchestrationStreamEvent['event'],
  data: unknown,
): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function writeSseEvent(
  response: SseResponse,
  event: OrchestrationStreamEvent['event'],
  data: unknown,
): void {
  response.write(formatSseEvent(event, data));
}

function createDefaultRunTeamDeps(args: {
  request: OrchestrationRequest;
  formation: PodFormation;
  leadRegistry: ReturnType<typeof createLeadRegistry>;
}): RunTeamDeps {
  const channel = createNoopChannel();

  return {
    pool: new WorkerPool({
      maxConcurrentEngagements: Math.max(1, args.formation.leads.length + 1),
    }),
    db: null,
    dataDir: DATA_DIR,
    workspacePath: process.cwd(),
    teamChannel: channel,
    humanChannel: channel,
    humanChatJid: args.request.humanChatJid,
    leadRegistry: args.leadRegistry,
    insertPodExecutionFn: async () => undefined,
    appendEventFn: async () => undefined,
    closePodExecutionFn: async () => undefined,
  };
}

function finalizePodResultEvent(
  podResult: PodResult,
): OrchestrationStreamEvent | null {
  if (podResult.status === 'timed_out') {
    return {
      event: 'timeout',
      data: podResult,
    };
  }
  if (podResult.status === 'failed' || podResult.status === 'aborted') {
    return {
      event: 'error',
      data: podResult,
    };
  }
  if (podResult.status === 'succeeded') {
    return {
      event: 'pod_completed',
      data: podResult,
    };
  }
  return null;
}

export async function handleOrchestrationRequest(
  response: SseResponse,
  body: unknown,
  options: OrchestrationApiOptions = {},
): Promise<void> {
  const parsed = OrchestrationRequestSchema.safeParse(body);
  if (!parsed.success) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        error: 'validation_error',
        details: parsed.error.issues,
      }),
    );
    return;
  }

  const request = parsed.data;
  const formation =
    request.timeout === request.formation.timeout
      ? request.formation
      : { ...request.formation, timeout: request.timeout };
  const leadRegistry = createLeadRegistry(
    applyLeadOverrides([...DEFAULT_LEADS, DEFAULT_COS], request.leadOverrides),
  );
  const baseDeps =
    options.createRunTeamDeps?.({
      request,
      formation,
      leadRegistry,
    }) ?? createDefaultRunTeamDeps({ request, formation, leadRegistry });

  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const appendEventFn: RunTeamDeps['appendEventFn'] = async (
    _db,
    _dataDir,
    event,
  ) => {
    const mapped = mapEventType(event);
    if (mapped) {
      writeSseEvent(response, mapped, event);
    }
  };

  try {
    const podResult = await (options.runTeamFn ?? runTeam)(formation, {
      ...baseDeps,
      leadRegistry,
      humanChatJid: request.humanChatJid,
      appendEventFn,
    });
    const finalEvent = finalizePodResultEvent(podResult);
    if (finalEvent) {
      writeSseEvent(response, finalEvent.event, finalEvent.data);
    }
  } catch (error) {
    writeSseEvent(response, 'error', {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    response.end();
  }
}
