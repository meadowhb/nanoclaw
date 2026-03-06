import type {
  CustomerSegment,
  LeadSkillSet,
  SegmentDefaults,
  SubagentContract,
  SubagentSpec,
  WorkerIdentity,
} from './types.js';
import {
  CapabilitySchema,
  LeadSkillSetSchema,
  SegmentDefaultsSchema,
  SideEffectsSchema,
  SubagentContractSchema,
  SubagentSpecSchema,
  WorkerIdentitySchema,
} from './types.js';
import { WORKER_IDENTITIES } from './worker-identities.js';
import { LEAD_SKILL_SETS } from './lead-skills.js';
import { SEGMENT_DEFAULTS } from './segment-defaults.js';
import { compileWorkerToAgentSpec } from './compile.js';
import {
  PRODUCT_LEAD_OWNED_SKILLS,
  PRODUCT_LEAD_SUBAGENTS,
} from './product-lead.js';

const workerIdentityById = new Map(
  WORKER_IDENTITIES.map((worker) => [worker.id, worker]),
);
const leadSkillSetByLeadId = new Map(
  LEAD_SKILL_SETS.map((leadSkillSet) => [leadSkillSet.leadId, leadSkillSet]),
);
const segmentDefaultsBySegment = new Map(
  SEGMENT_DEFAULTS.map((segmentDefaults) => [
    segmentDefaults.segment,
    segmentDefaults,
  ]),
);

export function getWorkersForLead(leadId: string): WorkerIdentity[] {
  return WORKER_IDENTITIES.filter((worker) => worker.leadId === leadId);
}

export function getWorkerIdentity(
  workerId: string,
): WorkerIdentity | undefined {
  return workerIdentityById.get(workerId);
}

export function getLeadSkillSet(leadId: string): LeadSkillSet | undefined {
  return leadSkillSetByLeadId.get(leadId);
}

export function getSegmentDefaults(
  segment: CustomerSegment,
): SegmentDefaults | undefined {
  return segmentDefaultsBySegment.get(segment);
}

export function getWorkersForLeadInSegment(
  leadId: string,
  segment: CustomerSegment,
): WorkerIdentity[] {
  const segmentDefaults = getSegmentDefaults(segment);

  if (!segmentDefaults || !segmentDefaults.activeLeads.includes(leadId)) {
    return [];
  }

  return getWorkersForLead(leadId).slice(0, segmentDefaults.maxWorkersPerLead);
}

export function validateWorkerReferences(
  workerIds: string[],
  leadIds: string[],
): { valid: true } | { valid: false; unknown: string[]; disallowed: string[] } {
  const unknown: string[] = [];
  const disallowed: string[] = [];

  for (const workerId of workerIds) {
    const worker = getWorkerIdentity(workerId);

    if (!worker) {
      unknown.push(workerId);
      continue;
    }

    if (!leadIds.includes(worker.leadId)) {
      disallowed.push(workerId);
    }
  }

  if (unknown.length === 0 && disallowed.length === 0) {
    return { valid: true };
  }

  return {
    valid: false,
    unknown,
    disallowed,
  };
}

export {
  CapabilitySchema,
  WorkerIdentitySchema,
  LeadSkillSetSchema,
  SegmentDefaultsSchema,
  SideEffectsSchema,
  SubagentContractSchema,
  SubagentSpecSchema,
  WORKER_IDENTITIES,
  LEAD_SKILL_SETS,
  SEGMENT_DEFAULTS,
  compileWorkerToAgentSpec,
  PRODUCT_LEAD_OWNED_SKILLS,
  PRODUCT_LEAD_SUBAGENTS,
};

export type {
  WorkerIdentity,
  LeadSkillSet,
  CustomerSegment,
  SegmentDefaults,
  SubagentContract,
  SubagentSpec,
} from './types.js';
