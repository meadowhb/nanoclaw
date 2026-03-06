import { z } from 'zod';

const kebabCase = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const CapabilitySchema = z.string().regex(kebabCase);
export const SideEffectsSchema = z.enum([
  'none',
  'workspace_only',
  'external_write',
]);

export const WorkerIdentitySchema = z
  .object({
    id: z.string().regex(kebabCase),
    leadId: z.string().regex(kebabCase),
    purpose: z.string().min(1).max(200),
    capabilities: z.array(CapabilitySchema).min(2).max(6),
    model: z.enum(['haiku', 'sonnet', 'opus']).default('haiku'),
  })
  .strict();

export const LeadSkillSetSchema = z
  .object({
    leadId: z.string().regex(kebabCase),
    ownedSkills: z.array(z.string().regex(kebabCase)).min(1),
  })
  .strict();

export type WorkerIdentity = z.infer<typeof WorkerIdentitySchema>;
export type LeadSkillSet = z.infer<typeof LeadSkillSetSchema>;
export type CustomerSegment = 'solopreneur' | 'pre-seed' | 'seed';

export const SegmentDefaultsSchema = z
  .object({
    segment: z.enum(['solopreneur', 'pre-seed', 'seed']),
    activeLeads: z.array(z.string().regex(kebabCase)).min(1),
    maxWorkersPerLead: z.number().int().min(1).max(10),
  })
  .strict();

export type SegmentDefaults = z.infer<typeof SegmentDefaultsSchema>;

export const SubagentContractSchema = z
  .object({
    required: z.array(z.string().regex(kebabCase)).min(1),
    optional: z.array(z.string().regex(kebabCase)).default([]),
  })
  .strict();

export const SubagentSpecSchema = z
  .object({
    id: z.string().regex(kebabCase),
    leadId: z.string().regex(kebabCase),
    title: z.string().min(1).max(80),
    purpose: z.string().min(1).max(200),
    capabilities: z.array(CapabilitySchema).min(2).max(6),
    model: z.enum(['haiku', 'sonnet', 'opus']).default('haiku'),
    timeoutDefault: z.number().positive(),
    sideEffects: SideEffectsSchema,
    produces: z.array(z.string().regex(kebabCase)).min(1),
    inputContract: SubagentContractSchema,
    outputContract: SubagentContractSchema,
    defaultSegments: z
      .array(z.enum(['solopreneur', 'pre-seed', 'seed']))
      .min(1),
    boundaries: z.array(z.string().regex(kebabCase)).min(1),
  })
  .strict();

export type SubagentContract = z.infer<typeof SubagentContractSchema>;
export type SubagentSpec = z.infer<typeof SubagentSpecSchema>;
