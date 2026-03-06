import type { RegisteredGroup } from './types.js';
import { runContainerAgent, type ContainerOutput } from './container-runner.js';
import type {
  SessionRuntime,
  SessionRuntimeContext,
  SessionRuntimeResult,
} from './session-runtime.js';
import {
  buildSerializedRuntimeTools,
  runtimeToolsContainerPaths,
  runtimeToolsHostPaths,
  writeRuntimeToolsManifest,
} from './runtime-tooling.js';

export interface ContainerSessionRuntimeOptions {
  runContainerAgentFn?: typeof runContainerAgent;
  promptBuilder?: (context: SessionRuntimeContext) => string;
}

function stringifyOptional(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function buildContainerSessionPrompt(
  context: SessionRuntimeContext,
): string {
  const payload = stringifyOptional(context.request.payload);
  const upstream = stringifyOptional(context.request.upstreamResults);

  return [
    `Lead: ${context.lead.leadId}`,
    `Objective: ${context.request.objective}`,
    '',
    context.lead.soul,
    '',
    payload ? `Payload:\n${payload}` : '',
    upstream ? `Upstream results:\n${upstream}` : '',
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

export async function runContainerSession(
  context: SessionRuntimeContext,
  options: ContainerSessionRuntimeOptions = {},
): Promise<SessionRuntimeResult> {
  const startedAt = Date.now();
  const runContainerAgentFn = options.runContainerAgentFn ?? runContainerAgent;
  const prompt =
    options.promptBuilder?.(context) ?? buildContainerSessionPrompt(context);
  const hostPaths = runtimeToolsHostPaths(context.instance);
  const containerPaths = runtimeToolsContainerPaths();
  writeRuntimeToolsManifest(hostPaths.manifestPath, {
    workspaceDir: '/workspace/group',
    eventsPath: containerPaths.eventsPath,
    tools: buildSerializedRuntimeTools(context),
  });
  const group: RegisteredGroup = {
    name: context.lead.leadId,
    folder: context.instance.bridgeGroupFolder,
    trigger: '@lead',
    added_at: new Date().toISOString(),
    requiresTrigger: false,
  };
  const output: ContainerOutput = await runContainerAgentFn(
    group,
    {
      prompt,
      sessionId: context.sessionId,
      groupFolder: context.instance.bridgeGroupFolder,
      chatJid: context.threadId,
      isMain: false,
      runtimeToolsFile: containerPaths.manifestPath,
    },
    () => undefined,
  );

  return {
    response:
      output.status === 'success'
        ? {
            schemaVersion: 1,
            requestId: context.request.requestId,
            status: 'success',
            result: output.result,
            durationMs: Date.now() - startedAt,
            tokensUsed: { input: 0, output: 0 },
          }
        : {
            schemaVersion: 1,
            requestId: context.request.requestId,
            status: 'error',
            error: output.error ?? 'container_error',
            durationMs: Date.now() - startedAt,
            tokensUsed: { input: 0, output: 0 },
          },
    sessionId: output.newSessionId ?? context.sessionId,
    resumeAt: output.resumeAt ?? context.resumeAt,
  };
}

export class ContainerSessionRuntime implements SessionRuntime {
  private readonly options: ContainerSessionRuntimeOptions;

  constructor(options: ContainerSessionRuntimeOptions = {}) {
    this.options = options;
  }

  async run(context: SessionRuntimeContext): Promise<SessionRuntimeResult> {
    return runContainerSession(context, this.options);
  }
}
