import { SubagentSpecSchema, type SubagentSpec } from './types.js';

export const PRODUCT_LEAD_OWNED_SKILLS = [
  'priority-tradeoff',
  'scope-control',
  'evidence-weighting',
  'roadmap-judgment',
] as const;

export const PRODUCT_LEAD_SUBAGENTS: SubagentSpec[] = [
  {
    id: 'product-feedback-clusterer',
    leadId: 'product-lead',
    title: 'Product Analyst',
    purpose:
      'Clusters product feedback into deduped, structured themes for prioritization.',
    capabilities: [
      'feedback-tagging',
      'request-deduping',
      'theme-extraction',
      'impact-signal-scoring',
    ],
    model: 'haiku',
    timeoutDefault: 120,
    sideEffects: 'none',
    produces: ['feedback-clusters', 'request-ranking', 'signal-scorecard'],
    inputContract: {
      required: ['feedback-backlog'],
      optional: ['support-tags', 'crm-notes', 'churn-signals'],
    },
    outputContract: {
      required: ['clustered-themes', 'top-requests', 'impact-signals'],
      optional: ['frequency-counts', 'segment-breakdown'],
    },
    defaultSegments: ['pre-seed', 'seed'],
    boundaries: ['does-not-approve-priority', 'does-not-write-final-roadmap'],
  },
  {
    id: 'product-discovery-synthesizer',
    leadId: 'product-lead',
    title: 'Product Researcher',
    purpose:
      'Synthesizes discovery evidence into clear pain points, jobs to be done, and opportunities.',
    capabilities: [
      'interview-synthesis',
      'jtbd-extraction',
      'pain-point-ranking',
      'opportunity-framing',
    ],
    model: 'haiku',
    timeoutDefault: 120,
    sideEffects: 'none',
    produces: ['insight-memo', 'pain-point-summary', 'opportunity-list'],
    inputContract: {
      required: ['research-notes-or-transcripts'],
      optional: ['support-themes', 'sales-notes', 'founder-hypotheses'],
    },
    outputContract: {
      required: ['top-pain-points', 'jobs-to-be-done', 'opportunity-areas'],
      optional: ['representative-quotes', 'confidence-notes'],
    },
    defaultSegments: ['pre-seed', 'seed'],
    boundaries: [
      'does-not-prioritize-roadmap',
      'does-not-commit-feature-scope',
    ],
  },
  {
    id: 'product-prd-drafter',
    leadId: 'product-lead',
    title: 'Product Manager',
    purpose:
      'Drafts product requirements, success criteria, and rollout details from lead direction.',
    capabilities: [
      'requirements-structuring',
      'acceptance-criteria-writing',
      'edge-case-enumeration',
      'rollout-planning',
    ],
    model: 'sonnet',
    timeoutDefault: 180,
    sideEffects: 'none',
    produces: ['prd-draft', 'acceptance-criteria', 'rollout-checklist'],
    inputContract: {
      required: ['selected-opportunity', 'target-user', 'goal'],
      optional: ['constraints', 'dependencies', 'success-metrics'],
    },
    outputContract: {
      required: ['problem-statement', 'scope', 'acceptance-criteria'],
      optional: ['edge-cases', 'rollout-plan', 'open-questions'],
    },
    defaultSegments: ['solopreneur', 'pre-seed', 'seed'],
    boundaries: ['does-not-finalize-scope', 'does-not-make-priority-tradeoffs'],
  },
  {
    id: 'product-roadmap-scorer',
    leadId: 'product-lead',
    title: 'Product Operations Analyst',
    purpose:
      'Scores roadmap options using impact, effort, sequencing, and dependency signals.',
    capabilities: [
      'rice-scoring',
      'dependency-mapping',
      'effort-risk-estimation',
      'sequencing-recommendation',
    ],
    model: 'haiku',
    timeoutDefault: 120,
    sideEffects: 'none',
    produces: ['priority-scorecard', 'dependency-map', 'sequencing-options'],
    inputContract: {
      required: ['candidate-initiatives'],
      optional: ['effort-estimates', 'dependency-notes', 'strategic-goals'],
    },
    outputContract: {
      required: [
        'ranked-options',
        'dependency-summary',
        'sequencing-recommendation',
      ],
      optional: ['risk-notes', 'assumption-log'],
    },
    defaultSegments: ['seed'],
    boundaries: [
      'does-not-set-final-roadmap',
      'does-not-override-lead-judgment',
    ],
  },
  {
    id: 'product-launch-checklist',
    leadId: 'product-lead',
    title: 'Product Marketing Manager',
    purpose:
      'Builds release and launch checklists so handoffs stay coordinated across teams.',
    capabilities: [
      'go-to-market-checklisting',
      'stakeholder-alignment',
      'release-readiness',
      'faq-generation',
    ],
    model: 'haiku',
    timeoutDefault: 120,
    sideEffects: 'none',
    produces: ['launch-checklist', 'release-brief', 'faq-draft'],
    inputContract: {
      required: ['approved-feature-scope'],
      optional: ['rollout-plan', 'audience-notes', 'support-risks'],
    },
    outputContract: {
      required: ['launch-tasks', 'stakeholder-handoffs', 'faq'],
      optional: ['release-risks', 'enablement-notes'],
    },
    defaultSegments: ['seed'],
    boundaries: ['does-not-own-core-positioning', 'does-not-approve-launch'],
  },
].map((subagent) => SubagentSpecSchema.parse(subagent));
