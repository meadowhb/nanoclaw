import { describe, expect, it } from 'vitest';

import {
  createLeadRegistry,
  DEFAULT_COS,
  DEFAULT_LEADS,
} from './lead-registry.js';

describe('lead-registry runtime defaults', () => {
  it('assigns hybrid runtime defaults to the built-in orchestration leads', () => {
    const registry = createLeadRegistry([...DEFAULT_LEADS, DEFAULT_COS]);

    expect(registry.get('engineering-lead')?.runtime).toMatchObject({
      executionMode: 'containerized',
    });
    expect(registry.get('support-lead')?.runtime).toMatchObject({
      executionMode: 'in_process',
    });
    expect(registry.get('chief-of-staff')?.runtime?.allowedTools).toEqual(
      expect.arrayContaining(['delegate_to_lead', 'report_progress']),
    );
  });
});
