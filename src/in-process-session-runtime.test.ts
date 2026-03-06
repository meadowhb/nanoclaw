import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildLeadInstance } from './lead-instances.js';
import { InProcessSessionRuntime } from './in-process-session-runtime.js';
import type { LeadBlueprint } from './orchestration-types.js';
import type {
  InProcessQueryOptions,
  RuntimeToolsServerCommand,
} from './in-process-session-runtime.js';
import type { SessionRuntimeContext } from './session-runtime.js';

function makeLead(): LeadBlueprint {
  return {
    leadId: 'support-lead',
    team: 'support',
    soul: 'Help the user and keep notes concise.',
    model: 'sonnet',
    channel: 'support-lead@team',
    maxConcurrentPods: 2,
    defaultTimeout: 60,
    runtime: {
      executionMode: 'in_process',
      allowedTools: ['report_progress', 'delegate_to_lead'],
    },
  };
}

function makeContext(rootDir: string): SessionRuntimeContext {
  const lead = makeLead();
  const instance = buildLeadInstance(rootDir, lead);

  return {
    lead,
    instance,
    request: {
      schemaVersion: 1,
      requestId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      attempt: 1,
      podId: 'pod-1',
      objective: 'Stabilize the runtime',
      payload: { scope: 'tooling' },
      upstreamResults: { planner: 'ready' },
      workspacePath: '/workspace',
      timeout: 30,
    },
    channelJid: lead.channel,
    threadId: 'pod-1',
    sessionId: 'session-prev',
    resumeAt: 'resume-prev',
    mcpTools: [
      {
        name: 'report_progress',
        description: 'Record a progress update',
        invoke: vi.fn(),
      },
      {
        name: 'delegate_to_lead',
        description: 'Delegate to another lead',
        invoke: vi.fn(),
      },
    ],
  };
}

let tempRoot = '';

afterEach(() => {
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = '';
  }
});

describe('in-process-session-runtime', () => {
  it('configures the Claude SDK with the orchestration MCP manifest', async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-inproc-'));
    const context = makeContext(tempRoot);
    const calls: InProcessQueryOptions[] = [];
    const runtimeToolsServer: RuntimeToolsServerCommand = {
      command: 'node',
      args: ['/tmp/runtime-tools.js'],
    };
    const queryFn = vi.fn(async function* (args: InProcessQueryOptions) {
      calls.push(args);
      yield {
        type: 'system',
        subtype: 'init',
        session_id: 'session-next',
      };
      yield {
        type: 'assistant',
        uuid: 'resume-next',
      };
      yield {
        type: 'result',
        result: { outcome: 'ok' },
      };
    });

    const runtime = new InProcessSessionRuntime({
      queryFn,
      resolveRuntimeToolsServer: () => runtimeToolsServer,
    });

    const result = await runtime.run(context);

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toContain('Objective: Stabilize the runtime');
    expect(calls[0]?.prompt).toContain('"scope": "tooling"');
    expect(calls[0]?.prompt).toContain('"planner": "ready"');

    const options = calls[0]?.options as {
      cwd: string;
      resume?: string;
      resumeSessionAt?: string;
      allowedTools: string[];
      mcpServers: {
        orchestration_runtime: {
          command: string;
          args: string[];
          env: Record<string, string>;
        };
      };
    };
    expect(options.cwd).toBe(context.instance.workspaceDir);
    expect(options.resume).toBe('session-prev');
    expect(options.resumeSessionAt).toBe('resume-prev');
    expect(options.allowedTools).toEqual([
      'report_progress',
      'delegate_to_lead',
    ]);
    expect(options.mcpServers.orchestration_runtime).toEqual({
      command: 'node',
      args: ['/tmp/runtime-tools.js'],
      env: {
        NANOCLAW_RUNTIME_TOOLS_FILE: path.join(
          context.instance.workspaceDir,
          '.nanoclaw',
          'runtime-tools.json',
        ),
      },
    });

    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(
          context.instance.workspaceDir,
          '.nanoclaw',
          'runtime-tools.json',
        ),
        'utf8',
      ),
    ) as {
      workspaceDir: string;
      eventsPath: string;
      tools: Array<{ name: string; description: string }>;
    };
    expect(manifest).toEqual({
      workspaceDir: context.instance.workspaceDir,
      eventsPath: path.join(
        context.instance.workspaceDir,
        '.nanoclaw',
        'runtime-tool-events.jsonl',
      ),
      tools: [
        {
          name: 'report_progress',
          description: 'Record a progress update',
        },
        {
          name: 'delegate_to_lead',
          description: 'Delegate to another lead',
        },
      ],
    });

    expect(result).toMatchObject({
      sessionId: 'session-next',
      resumeAt: 'resume-next',
      response: {
        status: 'success',
        result: { outcome: 'ok' },
      },
    });
  });
});
