import type {
  FunctionalTeam,
  LeadRuntimePolicy,
  LeadSpec,
} from './orchestration-types.js';
import { LeadSpecSchema } from './orchestration-types.js';

export interface LeadRegistry {
  get(leadId: string): LeadSpec | undefined;
  getByTeam(team: FunctionalTeam): LeadSpec[];
  allIds(): string[];
}

const DEFAULT_SUPPORT_ALLOWED_TOOLS = ['report_progress', 'escalate_to_human'];
const DEFAULT_COORDINATOR_ALLOWED_TOOLS = [
  'delegate_to_lead',
  'report_progress',
  'escalate_to_human',
];
const DEFAULT_ENGINEERING_ALLOWED_TOOLS = [
  'bash',
  'read_workspace',
  'write_workspace',
  'report_progress',
];

export function getDefaultRuntimePolicy(leadId: string): LeadRuntimePolicy {
  if (leadId === 'engineering-lead') {
    return {
      executionMode: 'containerized',
      allowedTools: [...DEFAULT_ENGINEERING_ALLOWED_TOOLS],
    };
  }

  if (leadId === 'chief-of-staff') {
    return {
      executionMode: 'in_process',
      allowedTools: [...DEFAULT_COORDINATOR_ALLOWED_TOOLS],
    };
  }

  return {
    executionMode: 'in_process',
    allowedTools: [...DEFAULT_SUPPORT_ALLOWED_TOOLS],
  };
}

function applyDefaultRuntimePolicy(lead: LeadSpec): LeadSpec {
  return {
    ...lead,
    runtime: lead.runtime ?? getDefaultRuntimePolicy(lead.leadId),
  };
}

const RAW_DEFAULT_LEADS: LeadSpec[] = [
  {
    leadId: 'sales-lead',
    team: 'sales',
    model: 'sonnet',
    channel: 'sales@team',
    maxConcurrentPods: 4,
    defaultTimeout: 300,
    soul: 'Owns pipeline growth and conversion. Runs tight qualification, clear messaging, and disciplined follow-through while balancing urgency with credibility.',
  },
  {
    leadId: 'support-lead',
    team: 'support',
    model: 'sonnet',
    channel: 'support@team',
    maxConcurrentPods: 6,
    defaultTimeout: 180,
    soul: 'Owns customer issue resolution end to end. Optimizes for fast triage, accurate root-cause framing, and empathetic communication under pressure.',
  },
  {
    leadId: 'ops-lead',
    team: 'ops',
    model: 'sonnet',
    channel: 'ops@team',
    maxConcurrentPods: 5,
    defaultTimeout: 240,
    soul: 'Owns operational reliability, process hygiene, and execution cadence. Designs practical systems that reduce risk and keep the business running smoothly.',
  },
  {
    leadId: 'product-lead',
    team: 'product',
    model: 'sonnet',
    channel: 'product@team',
    maxConcurrentPods: 4,
    defaultTimeout: 300,
    soul: 'Owns product direction, prioritization, and outcome clarity. Converts ambiguous demand into scoped decisions grounded in user value and delivery constraints.',
  },
  {
    leadId: 'marketing-lead',
    team: 'marketing',
    model: 'sonnet',
    channel: 'marketing@team',
    maxConcurrentPods: 4,
    defaultTimeout: 240,
    soul: 'Owns positioning, campaigns, and narrative consistency. Drives measurable demand while preserving brand trust and long-term audience relationships.',
  },
  {
    leadId: 'legal-lead',
    team: 'legal',
    model: 'sonnet',
    channel: 'legal@team',
    maxConcurrentPods: 3,
    defaultTimeout: 360,
    soul: 'Owns legal risk reduction and contract quality. Produces precise, business-aware guidance that protects downside without blocking sensible progress.',
  },
  {
    leadId: 'engineering-lead',
    team: 'engineering',
    model: 'sonnet',
    channel: 'engineering@team',
    maxConcurrentPods: 5,
    defaultTimeout: 300,
    soul: 'Owns technical delivery and system integrity. Balances speed, reliability, and maintainability while coordinating implementation across parallel streams.',
  },
];

export const DEFAULT_LEADS: LeadSpec[] = RAW_DEFAULT_LEADS.map(
  applyDefaultRuntimePolicy,
);

const RAW_DEFAULT_COS: LeadSpec = {
  leadId: 'chief-of-staff',
  team: 'cos',
  model: 'opus',
  channel: 'chief-of-staff@team',
  maxConcurrentPods: 8,
  defaultTimeout: 420,
  soul: 'Owns cross-functional orchestration for the CEO. Decomposes objectives, delegates to the right leads, reconciles tradeoffs, and returns concise executive decisions.',
};

export const DEFAULT_COS: LeadSpec = applyDefaultRuntimePolicy(RAW_DEFAULT_COS);

export function createLeadRegistry(
  leads: LeadSpec[] = [...DEFAULT_LEADS, DEFAULT_COS],
): LeadRegistry {
  const byId = new Map<string, LeadSpec>();

  for (const lead of leads) {
    const parsed = LeadSpecSchema.safeParse(lead);
    if (!parsed.success) {
      continue;
    }
    byId.set(parsed.data.leadId, applyDefaultRuntimePolicy(parsed.data));
  }

  return {
    get(leadId: string): LeadSpec | undefined {
      return byId.get(leadId);
    },
    getByTeam(team: FunctionalTeam): LeadSpec[] {
      return [...byId.values()].filter((lead) => lead.team === team);
    },
    allIds(): string[] {
      return [...byId.keys()];
    },
  };
}
