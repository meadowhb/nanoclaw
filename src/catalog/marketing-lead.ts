import { SubagentSpecSchema, type SubagentSpec } from './types.js';

export const MARKETING_LEAD_OWNED_SKILLS = [
  'positioning-choice',
  'channel-prioritization',
  'message-consistency',
  'campaign-go-no-go',
] as const;

export const MARKETING_LEAD_SUBAGENTS: SubagentSpec[] = [
  {
    id: 'marketing-audience-researcher',
    leadId: 'marketing-lead',
    title: 'Audience Researcher',
    purpose:
      'Researches target audiences, objections, and angles that can improve positioning.',
    capabilities: [
      'persona-building',
      'market-scan',
      'objection-mining',
      'message-angle-generation',
    ],
    model: 'haiku',
    timeoutDefault: 120,
    sideEffects: 'none',
    produces: ['audience-persona', 'objection-map', 'angle-options'],
    inputContract: {
      required: ['target-segment'],
      optional: ['existing-positioning', 'competitor-notes', 'icp-criteria'],
    },
    outputContract: {
      required: ['persona-profile', 'top-objections', 'recommended-angles'],
      optional: ['competitor-positioning', 'segment-size-estimate'],
    },
    defaultSegments: ['pre-seed', 'seed'],
    boundaries: [
      'does-not-finalize-positioning',
      'does-not-approve-campaign-spend',
    ],
  },
  {
    id: 'marketing-content-brief-writer',
    leadId: 'marketing-lead',
    title: 'Content Strategist',
    purpose:
      'Turns strategic direction into structured content briefs and outlines.',
    capabilities: [
      'topic-selection',
      'brief-structuring',
      'seo-outline-generation',
      'cta-mapping',
    ],
    model: 'haiku',
    timeoutDefault: 120,
    sideEffects: 'none',
    produces: ['content-brief', 'seo-outline', 'cta-plan'],
    inputContract: {
      required: ['campaign-goal', 'target-audience'],
      optional: ['keyword-targets', 'tone-guidelines', 'competitor-content'],
    },
    outputContract: {
      required: ['brief-document', 'outline', 'cta-recommendations'],
      optional: ['keyword-strategy', 'distribution-notes'],
    },
    defaultSegments: ['pre-seed', 'seed'],
    boundaries: [
      'does-not-write-final-copy',
      'does-not-approve-publication',
    ],
  },
  {
    id: 'marketing-campaign-analyst',
    leadId: 'marketing-lead',
    title: 'Campaign Analyst',
    purpose:
      'Analyzes campaign performance and suggests optimizations across channel, funnel, and spend.',
    capabilities: [
      'channel-performance-analysis',
      'creative-signal-detection',
      'funnel-dropoff-analysis',
      'budget-recommendation',
    ],
    model: 'haiku',
    timeoutDefault: 120,
    sideEffects: 'none',
    produces: ['performance-report', 'optimization-recommendations', 'roi-summary'],
    inputContract: {
      required: ['campaign-metrics'],
      optional: ['channel-breakdown', 'creative-variants', 'budget-allocation'],
    },
    outputContract: {
      required: ['performance-summary', 'top-recommendations', 'roi-analysis'],
      optional: ['channel-ranking', 'creative-winners', 'budget-reallocation'],
    },
    defaultSegments: ['seed'],
    boundaries: [
      'does-not-reallocate-budget',
      'does-not-pause-campaigns',
    ],
  },
  {
    id: 'marketing-brand-editor',
    leadId: 'marketing-lead',
    title: 'Brand Editor',
    purpose:
      'Edits content and campaign assets for clarity, consistency, and brand safety.',
    capabilities: [
      'voice-enforcement',
      'claim-safety-review',
      'clarity-editing',
      'asset-polish',
    ],
    model: 'sonnet',
    timeoutDefault: 180,
    sideEffects: 'none',
    produces: ['edited-draft', 'brand-review-notes', 'claim-flags'],
    inputContract: {
      required: ['draft-content'],
      optional: ['brand-guidelines', 'tone-reference', 'legal-constraints'],
    },
    outputContract: {
      required: ['edited-content', 'change-summary'],
      optional: ['claim-risk-flags', 'tone-deviation-notes'],
    },
    defaultSegments: ['pre-seed', 'seed'],
    boundaries: [
      'does-not-approve-publication',
      'does-not-override-lead-positioning',
    ],
  },
  {
    id: 'marketing-social-listener',
    leadId: 'marketing-lead',
    title: 'Social Intelligence Analyst',
    purpose:
      'Monitors social and community signals to surface trends and draft response options.',
    capabilities: [
      'mention-monitoring',
      'sentiment-tagging',
      'response-drafting',
      'trend-spotting',
    ],
    model: 'haiku',
    timeoutDefault: 120,
    sideEffects: 'none',
    produces: ['mention-digest', 'sentiment-report', 'response-drafts'],
    inputContract: {
      required: ['monitoring-scope'],
      optional: ['brand-keywords', 'competitor-handles', 'sentiment-baseline'],
    },
    outputContract: {
      required: ['mention-summary', 'sentiment-breakdown', 'recommended-responses'],
      optional: ['trend-signals', 'escalation-flags'],
    },
    defaultSegments: ['seed'],
    boundaries: [
      'does-not-post-publicly',
      'does-not-engage-without-lead-approval',
    ],
  },
].map((subagent) => SubagentSpecSchema.parse(subagent));
