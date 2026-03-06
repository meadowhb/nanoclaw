import { PRODUCT_LEAD_SUBAGENTS } from './product-lead.js';
import { WorkerIdentitySchema, type WorkerIdentity } from './types.js';

export const WORKER_IDENTITIES: WorkerIdentity[] = [
  {
    id: 'sales-lead-enricher',
    leadId: 'sales-lead',
    purpose:
      'Enriches inbound and target accounts with CRM, company, and buyer-context data for qualification.',
    capabilities: [
      'crm-lookup',
      'firmographic-enrichment',
      'contact-discovery',
      'buying-signal-detection',
    ],
  },
  {
    id: 'sales-qualification-scorer',
    leadId: 'sales-lead',
    purpose:
      'Scores lead quality, urgency, and fit so the lead can decide whether to pursue or disqualify.',
    capabilities: [
      'icp-scoring',
      'pain-urgency-estimation',
      'deal-breaker-detection',
      'next-step-recommendation',
    ],
  },
  {
    id: 'sales-sequence-drafter',
    leadId: 'sales-lead',
    purpose:
      'Drafts outbound and follow-up messaging sequences tailored to account context and objections.',
    capabilities: [
      'email-personalization',
      'followup-cadence-design',
      'objection-handling',
      'cta-optimization',
    ],
  },
  {
    id: 'sales-meeting-prep',
    leadId: 'sales-lead',
    purpose:
      'Prepares concise account and stakeholder briefs ahead of discovery and pipeline meetings.',
    capabilities: [
      'stakeholder-mapping',
      'discovery-question-generation',
      'account-briefing',
      'call-goal-definition',
    ],
  },
  {
    id: 'support-ticket-triager',
    leadId: 'support-lead',
    purpose:
      'Classifies support tickets, identifies priority, and routes them into the right queue.',
    capabilities: [
      'intent-classification',
      'priority-assignment',
      'duplicate-detection',
      'sla-routing',
    ],
  },
  {
    id: 'support-kb-retriever',
    leadId: 'support-lead',
    purpose:
      'Finds and ranks knowledge-base material that can support accurate customer responses.',
    capabilities: [
      'knowledge-search',
      'answer-extraction',
      'article-relevance-scoring',
      'gap-detection',
    ],
  },
  {
    id: 'support-bug-reproducer',
    leadId: 'support-lead',
    purpose:
      'Builds reproducible support bug packets so engineering receives actionable escalation context.',
    capabilities: [
      'repro-step-generation',
      'environment-matrixing',
      'log-interpretation',
      'eng-handoff-packaging',
    ],
  },
  {
    id: 'support-reply-drafter',
    leadId: 'support-lead',
    purpose:
      'Drafts empathetic support replies that set expectations clearly and match company policy.',
    capabilities: [
      'empathetic-response-writing',
      'macro-selection',
      'refund-explanation',
      'next-step-clarity',
    ],
  },
  {
    id: 'support-voc-clusterer',
    leadId: 'support-lead',
    purpose:
      'Clusters repeated support signals into themes the lead can use for quality and product decisions.',
    capabilities: [
      'theme-clustering',
      'pain-point-tagging',
      'feature-request-grouping',
      'churn-signal-detection',
    ],
  },
  {
    id: 'ops-exec-brief-compiler',
    leadId: 'ops-lead',
    purpose:
      'Compiles executive operations snapshots from metrics, risks, and action items.',
    capabilities: [
      'metric-rollup',
      'risk-summary',
      'weekly-brief-formatting',
      'action-item-extraction',
    ],
  },
  {
    id: 'ops-workflow-mapper',
    leadId: 'ops-lead',
    purpose:
      'Maps current workflows and identifies bottlenecks, handoff gaps, and process improvements.',
    capabilities: [
      'process-documentation',
      'bottleneck-detection',
      'automation-opportunity-scoring',
      'runbook-drafting',
    ],
  },
  {
    id: 'ops-invoice-collector',
    leadId: 'ops-lead',
    purpose:
      'Supports invoicing and collections workflows with aging analysis and reminder artifacts.',
    capabilities: [
      'invoice-generation-support',
      'payment-followup-drafting',
      'aging-analysis',
      'collections-prioritization',
    ],
  },
  {
    id: 'ops-vendor-evaluator',
    leadId: 'ops-lead',
    purpose:
      'Compares vendors and renewal options with pragmatic cost, process, and risk framing.',
    capabilities: [
      'vendor-comparison',
      'cost-benefit-analysis',
      'procurement-checklisting',
      'renewal-risk-flagging',
    ],
  },
  {
    id: 'ops-automation-scanner',
    leadId: 'ops-lead',
    purpose:
      'Scans for repetitive operational work and proposes tightly scoped automation opportunities.',
    capabilities: [
      'repetitive-task-detection',
      'tool-gap-mapping',
      'automation-spec-drafting',
      'handoff-packaging',
    ],
  },
  ...PRODUCT_LEAD_SUBAGENTS.map(
    ({ id, leadId, purpose, capabilities, model }): WorkerIdentity => ({
      id,
      leadId,
      purpose,
      capabilities,
      model,
    }),
  ),
  {
    id: 'marketing-audience-researcher',
    leadId: 'marketing-lead',
    purpose:
      'Researches target audiences, objections, and angles that can improve positioning.',
    capabilities: [
      'persona-building',
      'market-scan',
      'objection-mining',
      'message-angle-generation',
    ],
  },
  {
    id: 'marketing-content-brief-writer',
    leadId: 'marketing-lead',
    purpose:
      'Turns strategic direction into structured content briefs and outlines.',
    capabilities: [
      'topic-selection',
      'brief-structuring',
      'seo-outline-generation',
      'cta-mapping',
    ],
  },
  {
    id: 'marketing-campaign-analyst',
    leadId: 'marketing-lead',
    purpose:
      'Analyzes campaign performance and suggests optimizations across channel, funnel, and spend.',
    capabilities: [
      'channel-performance-analysis',
      'creative-signal-detection',
      'funnel-dropoff-analysis',
      'budget-recommendation',
    ],
  },
  {
    id: 'marketing-brand-editor',
    leadId: 'marketing-lead',
    purpose:
      'Edits content and campaign assets for clarity, consistency, and brand safety.',
    capabilities: [
      'voice-enforcement',
      'claim-safety-review',
      'clarity-editing',
      'asset-polish',
    ],
  },
  {
    id: 'marketing-social-listener',
    leadId: 'marketing-lead',
    purpose:
      'Monitors social and community signals to surface trends and draft response options.',
    capabilities: [
      'mention-monitoring',
      'sentiment-tagging',
      'response-drafting',
      'trend-spotting',
    ],
  },
  {
    id: 'legal-contract-extractor',
    leadId: 'legal-lead',
    purpose:
      'Extracts key contractual obligations, deadlines, and counterparty terms for review.',
    capabilities: [
      'clause-extraction',
      'obligation-mapping',
      'deadline-detection',
      'counterparty-term-summary',
    ],
  },
  {
    id: 'legal-clause-reviewer',
    leadId: 'legal-lead',
    purpose:
      'Reviews commercial and data terms to flag liabilities and negotiation points.',
    capabilities: [
      'msa-review',
      'dpa-review',
      'liability-flagging',
      'negotiation-point-generation',
    ],
  },
  {
    id: 'legal-policy-drafter',
    leadId: 'legal-lead',
    purpose:
      'Drafts policy and terms artifacts grounded in legal templates and business context.',
    capabilities: [
      'privacy-policy-drafting',
      'terms-drafting',
      'internal-policy-structuring',
      'jurisdiction-issue-flagging',
    ],
  },
  {
    id: 'legal-compliance-mapper',
    leadId: 'legal-lead',
    purpose:
      'Maps compliance requirements to controls, gaps, and evidence requests.',
    capabilities: [
      'requirement-mapping',
      'control-gap-detection',
      'evidence-request-generation',
      'readiness-scoring',
    ],
  },
  {
    id: 'legal-vendor-dpa-checker',
    leadId: 'legal-lead',
    purpose:
      'Checks vendor data-processing terms and security posture before approval.',
    capabilities: [
      'subprocessor-review',
      'security-term-review',
      'data-flow-flagging',
      'approval-memo-drafting',
    ],
  },
  {
    id: 'eng-code-reviewer',
    leadId: 'engineering-lead',
    purpose:
      'Reviews code for correctness, security, performance, and maintainability before shipping.',
    capabilities: [
      'correctness-review',
      'security-review',
      'performance-review',
      'maintainability-review',
    ],
  },
  {
    id: 'eng-ci-triager',
    leadId: 'engineering-lead',
    purpose:
      'Diagnoses CI failures and proposes likely fixes or rerun strategies.',
    capabilities: [
      'test-failure-diagnosis',
      'flake-detection',
      'fix-suggestion-generation',
      'rerun-strategy',
    ],
  },
  {
    id: 'eng-incident-investigator',
    leadId: 'engineering-lead',
    purpose:
      'Builds incident timelines and mitigation options for the lead during reliability events.',
    capabilities: [
      'timeline-reconstruction',
      'hypothesis-generation',
      'blast-radius-estimation',
      'mitigation-optioning',
    ],
  },
  {
    id: 'eng-bug-reproducer',
    leadId: 'engineering-lead',
    purpose:
      'Creates minimal bug reproductions and supporting evidence for implementation work.',
    capabilities: [
      'minimal-repro-creation',
      'environment-diffing',
      'log-trace-analysis',
      'ticket-packaging',
    ],
  },
  {
    id: 'eng-tech-debt-auditor',
    leadId: 'engineering-lead',
    purpose:
      'Audits technical debt and organizes practical cleanup opportunities into a ranked queue.',
    capabilities: [
      'debt-inventory',
      'refactor-opportunity-scoring',
      'risk-estimation',
      'cleanup-batching',
    ],
  },
  {
    id: 'eng-perf-profiler',
    leadId: 'engineering-lead',
    purpose:
      'Profiles performance issues and proposes optimization targets with supporting evidence.',
    capabilities: [
      'hotspot-detection',
      'query-analysis',
      'latency-breakdown',
      'optimization-recommendation',
    ],
  },
].map((worker) => WorkerIdentitySchema.parse(worker));
