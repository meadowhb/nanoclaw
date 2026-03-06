import type { SegmentDefaults } from './types.js';

export const SEGMENT_DEFAULTS: SegmentDefaults[] = [
  {
    segment: 'solopreneur',
    activeLeads: ['sales-lead', 'marketing-lead', 'ops-lead'],
    maxWorkersPerLead: 2,
  },
  {
    segment: 'pre-seed',
    activeLeads: [
      'sales-lead',
      'ops-lead',
      'product-lead',
      'engineering-lead',
      'marketing-lead',
    ],
    maxWorkersPerLead: 3,
  },
  {
    segment: 'seed',
    activeLeads: [
      'sales-lead',
      'support-lead',
      'ops-lead',
      'product-lead',
      'marketing-lead',
      'legal-lead',
      'engineering-lead',
    ],
    maxWorkersPerLead: 6,
  },
];
