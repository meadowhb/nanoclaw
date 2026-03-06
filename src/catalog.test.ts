import { describe, expect, it } from 'vitest';

import { DEFAULT_LEADS } from './lead-registry.js';
import {
  compileWorkerToAgentSpec,
  getLeadSkillSet,
  getSegmentDefaults,
  getWorkerIdentity,
  getWorkersForLead,
  getWorkersForLeadInSegment,
  LEAD_SKILL_SETS,
  LeadSkillSetSchema,
  PRODUCT_LEAD_OWNED_SKILLS,
  PRODUCT_LEAD_SUBAGENTS,
  SEGMENT_DEFAULTS,
  SegmentDefaultsSchema,
  SubagentSpecSchema,
  validateWorkerReferences,
  WORKER_IDENTITIES,
  WorkerIdentitySchema,
} from './catalog/index.js';
import { AgentSpecSchema } from './orchestration-types.js';

describe('catalog schemas', () => {
  it('every worker identity passes WorkerIdentitySchema.parse()', () => {
    for (const worker of WORKER_IDENTITIES) {
      expect(() => WorkerIdentitySchema.parse(worker)).not.toThrow();
    }
  });

  it('every lead skill set passes LeadSkillSetSchema.parse()', () => {
    for (const leadSkillSet of LEAD_SKILL_SETS) {
      expect(() => LeadSkillSetSchema.parse(leadSkillSet)).not.toThrow();
    }
  });

  it('every segment default passes SegmentDefaultsSchema.parse()', () => {
    for (const segmentDefaults of SEGMENT_DEFAULTS) {
      expect(() => SegmentDefaultsSchema.parse(segmentDefaults)).not.toThrow();
    }
  });

  it('all worker identity IDs are globally unique', () => {
    const workerIds = WORKER_IDENTITIES.map((worker) => worker.id);
    expect(new Set(workerIds).size).toBe(workerIds.length);
  });

  it('all worker identity leadIds exist in DEFAULT_LEADS', () => {
    const leadIds = new Set(DEFAULT_LEADS.map((lead) => lead.leadId));
    for (const worker of WORKER_IDENTITIES) {
      expect(leadIds.has(worker.leadId)).toBe(true);
    }
  });

  it('every product subagent passes SubagentSpecSchema.parse()', () => {
    for (const subagent of PRODUCT_LEAD_SUBAGENTS) {
      expect(() => SubagentSpecSchema.parse(subagent)).not.toThrow();
    }
  });
});

describe('catalog lookups', () => {
  it("getWorkersForLead('sales-lead') returns exactly 4 workers", () => {
    expect(getWorkersForLead('sales-lead')).toHaveLength(4);
  });

  it("getWorkersForLead('unknown-lead') returns []", () => {
    expect(getWorkersForLead('unknown-lead')).toEqual([]);
  });

  it("getWorkerIdentity('sales-lead-enricher') returns the correct worker", () => {
    expect(getWorkerIdentity('sales-lead-enricher')).toMatchObject({
      id: 'sales-lead-enricher',
      leadId: 'sales-lead',
    });
  });

  it("getWorkerIdentity('nonexistent') returns undefined", () => {
    expect(getWorkerIdentity('nonexistent')).toBeUndefined();
  });

  it("getSegmentDefaults('solopreneur') returns 3 active leads with maxWorkersPerLead=2", () => {
    expect(getSegmentDefaults('solopreneur')).toEqual({
      segment: 'solopreneur',
      activeLeads: ['sales-lead', 'marketing-lead', 'ops-lead'],
      maxWorkersPerLead: 2,
    });
  });

  it("getWorkersForLeadInSegment('sales-lead', 'solopreneur') returns at most 2 workers", () => {
    expect(
      getWorkersForLeadInSegment('sales-lead', 'solopreneur'),
    ).toHaveLength(2);
  });

  it("getWorkersForLeadInSegment('legal-lead', 'solopreneur') returns []", () => {
    expect(getWorkersForLeadInSegment('legal-lead', 'solopreneur')).toEqual([]);
  });

  it("getWorkersForLead('marketing-lead') returns the complete canonical marketing worker set", () => {
    expect(
      getWorkersForLead('marketing-lead').map((worker) => worker.id),
    ).toEqual([
      'marketing-audience-researcher',
      'marketing-content-brief-writer',
      'marketing-campaign-analyst',
      'marketing-brand-editor',
      'marketing-social-listener',
    ]);
  });

  it("getLeadSkillSet('marketing-lead') returns the canonical marketing decision skills", () => {
    expect(getLeadSkillSet('marketing-lead')).toEqual({
      leadId: 'marketing-lead',
      ownedSkills: [
        'positioning-choice',
        'channel-prioritization',
        'message-consistency',
        'campaign-go-no-go',
      ],
    });
  });
});

describe('catalog validation', () => {
  it("validateWorkerReferences(['sales-lead-enricher'], ['sales-lead']) returns valid", () => {
    expect(
      validateWorkerReferences(['sales-lead-enricher'], ['sales-lead']),
    ).toEqual({ valid: true });
  });

  it("validateWorkerReferences(['sales-lead-enricher'], ['ops-lead']) returns disallowed", () => {
    expect(
      validateWorkerReferences(['sales-lead-enricher'], ['ops-lead']),
    ).toEqual({
      valid: false,
      unknown: [],
      disallowed: ['sales-lead-enricher'],
    });
  });

  it("validateWorkerReferences(['nonexistent'], ['sales-lead']) returns unknown", () => {
    expect(validateWorkerReferences(['nonexistent'], ['sales-lead'])).toEqual({
      valid: false,
      unknown: ['nonexistent'],
      disallowed: [],
    });
  });
});

describe('catalog compile', () => {
  it('compileWorkerToAgentSpec output passes AgentSpecSchema.parse()', () => {
    const worker = getWorkerIdentity('sales-lead-enricher');
    expect(worker).toBeDefined();
    const compiled = compileWorkerToAgentSpec(worker!, { group: 'test' });
    expect(() => AgentSpecSchema.parse(compiled)).not.toThrow();
  });

  it("compiled spec has role 'member', side_effects 'none', and mode 'single_turn'", () => {
    const worker = getWorkerIdentity('sales-lead-enricher');
    expect(worker).toBeDefined();
    const compiled = compileWorkerToAgentSpec(worker!, { group: 'test' });
    expect(compiled.role).toBe('member');
    expect(compiled.side_effects).toBe('none');
    expect(compiled.mode).toBe('single_turn');
  });
});

describe('product lead subagents', () => {
  it('defines exactly five product lead subagents', () => {
    expect(PRODUCT_LEAD_SUBAGENTS).toHaveLength(5);
  });

  it('keeps product lead owned skills aligned with the lead skill set', () => {
    const productLeadSkills = LEAD_SKILL_SETS.find(
      (entry) => entry.leadId === 'product-lead',
    );

    expect(productLeadSkills?.ownedSkills).toEqual([
      ...PRODUCT_LEAD_OWNED_SKILLS,
    ]);
  });

  it('maps every product subagent into the worker identity catalog', () => {
    const workerIds = new Set(
      WORKER_IDENTITIES.filter(
        (worker) => worker.leadId === 'product-lead',
      ).map((worker) => worker.id),
    );

    expect(workerIds).toEqual(
      new Set(PRODUCT_LEAD_SUBAGENTS.map((subagent) => subagent.id)),
    );
  });

  it('marks only the product manager subagent as sonnet', () => {
    const sonnetIds = PRODUCT_LEAD_SUBAGENTS.filter(
      (subagent) => subagent.model === 'sonnet',
    ).map((subagent) => subagent.id);

    expect(sonnetIds).toEqual(['product-prd-drafter']);
  });
});

describe('validateWorkerReferences', () => {
  it('returns valid when worker list is empty', () => {
    expect(validateWorkerReferences([], ['sales-lead'])).toEqual({ valid: true });
  });

  it('returns invalid when a worker ID is unknown', () => {
    expect(validateWorkerReferences(['nonexistent-worker'], ['sales-lead'])).toEqual({
      valid: false,
      unknown: ['nonexistent-worker'],
      disallowed: [],
    });
  });
});
