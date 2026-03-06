import type { LeadSkillSet } from './types.js';
import { PRODUCT_LEAD_OWNED_SKILLS } from './product-lead.js';
import { MARKETING_LEAD_OWNED_SKILLS } from './marketing-lead.js';

export const LEAD_SKILL_SETS: LeadSkillSet[] = [
  {
    leadId: 'sales-lead',
    ownedSkills: [
      'pipeline-prioritization',
      'icp-judgment',
      'followup-strategy',
      'deal-risk-flagging',
    ],
  },
  {
    leadId: 'support-lead',
    ownedSkills: [
      'severity-gating',
      'queue-prioritization',
      'escalation-routing',
      'customer-tone-control',
    ],
  },
  {
    leadId: 'ops-lead',
    ownedSkills: [
      'cadence-management',
      'cross-functional-synthesis',
      'sla-monitoring',
      'process-enforcement',
    ],
  },
  {
    leadId: 'product-lead',
    ownedSkills: [...PRODUCT_LEAD_OWNED_SKILLS],
  },
  {
    leadId: 'marketing-lead',
    ownedSkills: [...MARKETING_LEAD_OWNED_SKILLS],
  },
  {
    leadId: 'legal-lead',
    ownedSkills: [
      'risk-tiering',
      'redline-strategy',
      'approval-thresholding',
      'exception-logging',
    ],
  },
  {
    leadId: 'engineering-lead',
    ownedSkills: [
      'architecture-judgment',
      'ship-blocker-decision',
      'rollback-recommendation',
      'implementation-prioritization',
    ],
  },
];
