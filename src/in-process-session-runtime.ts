import { createRequire } from 'node:module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type {
  SessionRuntime,
  SessionRuntimeContext,
  SessionRuntimeResult,
} from './session-runtime.js';
import {
  buildSerializedRuntimeTools,
  runtimeToolsHostPaths,
  writeRuntimeToolsManifest,
} from './runtime-tooling.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(moduleDir, '..');
const agentRunnerRoot = path.join(packageRoot, 'container', 'agent-runner');

export interface InProcessQueryOptions {
  prompt: string;
  options: Record<string, unknown>;
}

export type InProcessQueryMessage = Record<string, unknown>;

export type InProcessQueryFn = (
  args: InProcessQueryOptions,
) => AsyncIterable<InProcessQueryMessage>;

export interface RuntimeToolsServerCommand {
  command: string;
  args: string[];
}

export interface InProcessSessionRuntimeOptions {
  queryFn?: InProcessQueryFn;
  promptBuilder?: (context: SessionRuntimeContext) => string;
  resolveRuntimeToolsServer?: () => RuntimeToolsServerCommand;
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

export function buildInProcessSessionPrompt(
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

async function loadQueryFn(): Promise<InProcessQueryFn> {
  const require = createRequire(import.meta.url);
  const sdkEntry = require.resolve('@anthropic-ai/claude-agent-sdk', {
    paths: [agentRunnerRoot],
  });
  const moduleUrl = pathToFileURL(sdkEntry).href;
  const sdk = (await import(moduleUrl)) as { query: InProcessQueryFn };
  return sdk.query;
}

function resolveTsxBinary(): string {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve('tsx/dist/cli.mjs', {
      paths: [packageRoot],
    });
  } catch {
    return path.join(packageRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  }
}

function defaultResolveRuntimeToolsServer(): RuntimeToolsServerCommand {
  const distPath = path.join(
    agentRunnerRoot,
    'dist',
    'runtime-tools-mcp-stdio.js',
  );
  if (fs.existsSync(distPath)) {
    return { command: 'node', args: [distPath] };
  }

  const sourcePath = path.join(
    agentRunnerRoot,
    'src',
    'runtime-tools-mcp-stdio.ts',
  );
  return { command: 'node', args: [resolveTsxBinary(), sourcePath] };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export class InProcessSessionRuntime implements SessionRuntime {
  private readonly queryFnPromise: Promise<InProcessQueryFn>;
  private readonly promptBuilder: (context: SessionRuntimeContext) => string;
  private readonly resolveRuntimeToolsServer: () => RuntimeToolsServerCommand;

  constructor(options: InProcessSessionRuntimeOptions = {}) {
    this.queryFnPromise = options.queryFn
      ? Promise.resolve(options.queryFn)
      : loadQueryFn();
    this.promptBuilder =
      options.promptBuilder ?? buildInProcessSessionPrompt;
    this.resolveRuntimeToolsServer =
      options.resolveRuntimeToolsServer ?? defaultResolveRuntimeToolsServer;
  }

  async run(context: SessionRuntimeContext): Promise<SessionRuntimeResult> {
    const startedAt = Date.now();
    const { manifestPath, eventsPath } = runtimeToolsHostPaths(context.instance);
    writeRuntimeToolsManifest(manifestPath, {
      workspaceDir: context.instance.workspaceDir,
      eventsPath,
      tools: buildSerializedRuntimeTools(context),
    });

    const runtimeToolsServer = this.resolveRuntimeToolsServer();
    const queryFn = await this.queryFnPromise;
    const prompt = this.promptBuilder(context);
    const allowedTools = context.mcpTools.map((tool) => tool.name);

    let sessionId = context.sessionId;
    let resumeAt = context.resumeAt;
    let latestResult: unknown = null;

    for await (const message of queryFn({
      prompt,
      options: {
        cwd: context.instance.workspaceDir,
        resume: sessionId,
        resumeSessionAt: resumeAt,
        settingSources: ['project', 'user'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        allowedTools,
        mcpServers: {
          orchestration_runtime: {
            command: runtimeToolsServer.command,
            args: runtimeToolsServer.args,
            env: {
              NANOCLAW_RUNTIME_TOOLS_FILE: manifestPath,
            },
          },
        },
      },
    })) {
      if (
        message.type === 'system' &&
        (message as { subtype?: string }).subtype === 'init'
      ) {
        sessionId = asString((message as { session_id?: unknown }).session_id) ?? sessionId;
      }

      if (message.type === 'assistant') {
        resumeAt = asString((message as { uuid?: unknown }).uuid) ?? resumeAt;
      }

      if (message.type === 'result' && 'result' in message) {
        latestResult = (message as { result?: unknown }).result ?? latestResult;
      }
    }

    return {
      response: {
        schemaVersion: 1,
        requestId: context.request.requestId,
        status: 'success',
        result: latestResult,
        durationMs: Date.now() - startedAt,
        tokensUsed: { input: 0, output: 0 },
      },
      sessionId,
      resumeAt,
    };
  }
}
