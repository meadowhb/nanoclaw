import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildLeadInstance } from './lead-instances.js';
import {
  buildContainerSessionPrompt,
  runContainerSession,
} from './container-session-runtime.js';
import type { ContainerInput, ContainerOutput } from './container-runner.js';
import type { RegisteredGroup } from './types.js';
import type { LeadBlueprint } from './orchestration-types.js';
import type { SessionRuntimeContext } from './session-runtime.js';

function makeLead(): LeadBlueprint {
  return {
    leadId: 'engineering-lead',
    team: 'engineering',
    soul: 'Ship safe code changes with high signal summaries.',
    model: 'sonnet',
    channel: 'engineering-lead@team',
    maxConcurrentPods: 2,
    defaultTimeout: 60,
    runtime: {
      executionMode: 'containerized',
      allowedTools: ['bash', 'write_workspace'],
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
      objective: 'Patch the release blocker',
      payload: { file: 'README.md' },
      upstreamResults: { reviewer: 'approved' },
      workspacePath: '/workspace',
      timeout: 30,
    },
    channelJid: lead.channel,
    threadId: 'pod-1',
    sessionId: 'session-prev',
    resumeAt: 'resume-prev',
    mcpTools: [
      {
        name: 'bash',
        description: 'Run a shell command',
        invoke: vi.fn(),
      },
      {
        name: 'write_workspace',
        description: 'Write into the workspace',
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

describe('container-session-runtime', () => {
  it('passes the orchestration MCP manifest into the container runtime', async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-container-'));
    const context = makeContext(tempRoot);
    const calls: Array<{
      group: RegisteredGroup;
      input: ContainerInput;
    }> = [];
    const runContainerAgentFn = vi.fn(
      async (
        group: RegisteredGroup,
        input: ContainerInput,
      ): Promise<ContainerOutput> => {
        calls.push({ group, input });
        return {
          status: 'success',
          result: 'patched',
          newSessionId: 'session-next',
          resumeAt: 'resume-next',
        };
      },
    );

    const result = await runContainerSession(context, {
      runContainerAgentFn,
    });

    expect(runContainerAgentFn).toHaveBeenCalledTimes(1);
    expect(calls[0]?.group).toMatchObject({
      name: 'engineering-lead',
      folder: 'lead-engineering-lead',
      requiresTrigger: false,
    });
    expect(calls[0]?.input).toMatchObject({
      sessionId: 'session-prev',
      groupFolder: 'lead-engineering-lead',
      chatJid: 'pod-1',
      isMain: false,
      runtimeToolsFile: '/workspace/group/.nanoclaw/runtime-tools.json',
    });
    expect(calls[0]?.input.prompt).toContain(
      'Objective: Patch the release blocker',
    );
    expect(calls[0]?.input.prompt).toContain('"file": "README.md"');
    expect(calls[0]?.input.prompt).toContain('"reviewer": "approved"');

    const manifestPath = path.join(
      context.instance.workspaceDir,
      '.nanoclaw',
      'runtime-tools.json',
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      workspaceDir: string;
      eventsPath: string;
      tools: Array<{ name: string; description: string }>;
    };
    expect(manifest).toEqual({
      workspaceDir: '/workspace/group',
      eventsPath: '/workspace/group/.nanoclaw/runtime-tool-events.jsonl',
      tools: [
        {
          name: 'bash',
          description: 'Run a shell command',
        },
        {
          name: 'write_workspace',
          description: 'Write into the workspace',
        },
      ],
    });

    expect(result).toMatchObject({
      sessionId: 'session-next',
      resumeAt: 'resume-next',
      response: {
        status: 'success',
        result: 'patched',
      },
    });
  });

  it('builds a stable prompt contract for container sessions', () => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'nanoclaw-container-prompt-'),
    );
    const prompt = buildContainerSessionPrompt(makeContext(tempRoot));

    expect(prompt).toContain('Lead: engineering-lead');
    expect(prompt).toContain('Objective: Patch the release blocker');
    expect(prompt).toContain('Payload:');
    expect(prompt).toContain('Upstream results:');
  });
});
