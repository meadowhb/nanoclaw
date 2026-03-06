import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';

import {
  AgentRequestSchema,
  AgentResponseSchema,
  AgentSpecSchema,
  ChannelEnvelopeSchema,
  LeadRuntimePolicySchema,
  LeadSpecSchema,
  PodFormationSchema,
} from './orchestration-types.js';

function validRequest() {
  return {
    schemaVersion: 1 as const,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    attempt: 1,
    podId: 'pod-1',
    objective: 'do work',
    payload: { hello: 'world' },
    upstreamResults: { prior: true },
    workspacePath: '/tmp/workspace',
    timeout: 300,
  };
}

function validResponseBase() {
  return {
    schemaVersion: 1 as const,
    requestId: randomUUID(),
    durationMs: 100,
    tokensUsed: { input: 10, output: 5 },
    artifacts: ['artifact.txt'],
  };
}

function validAgentSpec() {
  return {
    name: 'legal-counsel',
    role: 'member' as const,
    prompt: 'Review this document',
    model: 'sonnet' as const,
    timeout: 300,
    mode: 'single_turn' as const,
    side_effects: 'none' as const,
    soul: 'A valid soul',
    identity: {
      group: 'legal',
      credentials: { token: 'abc' },
    },
  };
}

function validPodFormation() {
  return {
    name: 'engineering-team',
    objective: 'Ship feature',
    leads: ['engineering-lead'],
    coordinatorId: 'engineering-lead',
    timeout: 600,
  };
}

function validChannelEnvelope() {
  return {
    schemaVersion: 1 as const,
    type: 'work_request' as const,
    requestId: randomUUID(),
    senderId: 'orchestrator',
    timestamp: Date.now(),
    payload: { any: 'value' },
  };
}

describe('types.AgentRequestSchema', () => {
  it('accepts valid request', () => {
    const parsed = AgentRequestSchema.safeParse(validRequest());
    expect(parsed.success).toBe(true);
  });

  it('rejects schemaVersion: 2', () => {
    const parsed = AgentRequestSchema.safeParse({
      ...validRequest(),
      schemaVersion: 2,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects missing schemaVersion', () => {
    const req = validRequest();
    const { schemaVersion: _schemaVersion, ...withoutSchemaVersion } = req;
    const parsed = AgentRequestSchema.safeParse(withoutSchemaVersion);
    expect(parsed.success).toBe(false);
  });

  it('rejects non-UUID requestId', () => {
    const parsed = AgentRequestSchema.safeParse({
      ...validRequest(),
      requestId: 'not-a-uuid',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects attempt < 1', () => {
    const parsed = AgentRequestSchema.safeParse({
      ...validRequest(),
      attempt: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown keys (.strict)', () => {
    const parsed = AgentRequestSchema.safeParse({
      ...validRequest(),
      extra: 'nope',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('types.AgentResponseSchema', () => {
  it("accepts valid success response (schemaVersion: 1, status: 'success', result set, no error)", () => {
    const parsed = AgentResponseSchema.safeParse({
      ...validResponseBase(),
      status: 'success',
      result: { ok: true },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts valid error response (schemaVersion: 1, status: 'error', error string present)", () => {
    const parsed = AgentResponseSchema.safeParse({
      ...validResponseBase(),
      status: 'error',
      error: 'failed',
      result: { partial: true },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects schemaVersion: 2', () => {
    const parsed = AgentResponseSchema.safeParse({
      ...validResponseBase(),
      schemaVersion: 2,
      status: 'success',
      result: { ok: true },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects error response with missing error field', () => {
    const parsed = AgentResponseSchema.safeParse({
      ...validResponseBase(),
      status: 'error',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects success response with error field present', () => {
    const parsed = AgentResponseSchema.safeParse({
      ...validResponseBase(),
      status: 'success',
      result: { ok: true },
      error: 'should not be here',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects non-UUID requestId', () => {
    const parsed = AgentResponseSchema.safeParse({
      ...validResponseBase(),
      requestId: 'not-a-uuid',
      status: 'success',
      result: { ok: true },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects negative durationMs', () => {
    const parsed = AgentResponseSchema.safeParse({
      ...validResponseBase(),
      durationMs: -1,
      status: 'success',
      result: { ok: true },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown keys (.strict)', () => {
    const parsed = AgentResponseSchema.safeParse({
      ...validResponseBase(),
      status: 'success',
      result: { ok: true },
      extra: 'nope',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('types.AgentSpecSchema', () => {
  it('rejects name with uppercase (Legal-Counsel) or spaces', () => {
    const uppercase = AgentSpecSchema.safeParse({
      ...validAgentSpec(),
      name: 'Legal-Counsel',
    });
    const withSpaces = AgentSpecSchema.safeParse({
      ...validAgentSpec(),
      name: 'legal counsel',
    });
    expect(uppercase.success).toBe(false);
    expect(withSpaces.success).toBe(false);
  });

  it('rejects empty soul', () => {
    const parsed = AgentSpecSchema.safeParse({
      ...validAgentSpec(),
      soul: '',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('types.PodFormationSchema', () => {
  it('rejects empty leads array', () => {
    const parsed = PodFormationSchema.safeParse({
      ...validPodFormation(),
      leads: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("outputs visibility: 'medium' when field omitted from input", () => {
    const parsed = PodFormationSchema.safeParse(validPodFormation());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.visibility).toBe('medium');
    }
  });

  it('rejects max_iterations: 0', () => {
    const parsed = PodFormationSchema.safeParse({
      ...validPodFormation(),
      max_iterations: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts allowedWorkerIdentityIds when they are kebab-case', () => {
    const parsed = PodFormationSchema.safeParse({
      ...validPodFormation(),
      allowedWorkerIdentityIds: ['engineering-code-reviewer'],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('types.LeadSpecSchema', () => {
  it('accepts valid lead spec', () => {
    const parsed = LeadSpecSchema.safeParse({
      leadId: 'engineering-lead',
      team: 'engineering',
      soul: 'Leads engineering execution.',
      model: 'sonnet',
      channel: 'engineering@team',
      maxConcurrentPods: 3,
      defaultTimeout: 300,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid leadId', () => {
    const parsed = LeadSpecSchema.safeParse({
      leadId: 'EngineeringLead',
      team: 'engineering',
      soul: 'Leads engineering execution.',
      model: 'sonnet',
      channel: 'engineering@team',
      maxConcurrentPods: 3,
      defaultTimeout: 300,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const parsed = LeadSpecSchema.safeParse({
      leadId: 'engineering-lead',
      team: 'engineering',
      model: 'sonnet',
      channel: 'engineering@team',
      maxConcurrentPods: 3,
      defaultTimeout: 300,
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts runtime policy metadata for hybrid execution', () => {
    const parsed = LeadSpecSchema.safeParse({
      leadId: 'engineering-lead',
      team: 'engineering',
      soul: 'Leads engineering execution.',
      model: 'sonnet',
      channel: 'engineering@team',
      maxConcurrentPods: 3,
      defaultTimeout: 300,
      runtime: {
        executionMode: 'containerized',
        allowedTools: ['bash', 'write_workspace'],
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe('types.LeadRuntimePolicySchema', () => {
  it('rejects unsupported execution modes', () => {
    const parsed = LeadRuntimePolicySchema.safeParse({
      executionMode: 'unsupported',
      allowedTools: ['bash'],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('types.ChannelEnvelopeSchema', () => {
  it('rejects schemaVersion: 2', () => {
    const parsed = ChannelEnvelopeSchema.safeParse({
      ...validChannelEnvelope(),
      schemaVersion: 2,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown type value', () => {
    const parsed = ChannelEnvelopeSchema.safeParse({
      ...validChannelEnvelope(),
      type: 'not-a-type',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects non-UUID requestId', () => {
    const parsed = ChannelEnvelopeSchema.safeParse({
      ...validChannelEnvelope(),
      requestId: 'not-a-uuid',
    });
    expect(parsed.success).toBe(false);
  });
});
