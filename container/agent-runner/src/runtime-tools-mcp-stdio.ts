import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const manifestPath = process.env.NANOCLAW_RUNTIME_TOOLS_FILE;
if (!manifestPath) {
  throw new Error('NANOCLAW_RUNTIME_TOOLS_FILE is required');
}

interface RuntimeToolManifest {
  workspaceDir: string;
  eventsPath: string;
  tools: Array<{ name: string; description: string }>;
}

const manifest = JSON.parse(
  fs.readFileSync(manifestPath, 'utf8'),
) as RuntimeToolManifest;

function ensureWithinWorkspace(relativePath: string): string {
  const resolved = path.resolve(manifest.workspaceDir, relativePath);
  const relative = path.relative(manifest.workspaceDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return resolved;
}

function appendEvent(type: string, payload: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(manifest.eventsPath), { recursive: true });
  fs.appendFileSync(
    manifest.eventsPath,
    `${JSON.stringify({
      type,
      payload,
      timestamp: new Date().toISOString(),
    })}\n`,
  );
}

const server = new McpServer({
  name: 'nanoclaw-orchestration-runtime',
  version: '1.0.0',
});

for (const tool of manifest.tools) {
  switch (tool.name) {
    case 'read_workspace':
      server.tool(
        tool.name,
        tool.description,
        { path: z.string() },
        async (args) => {
          const filePath = ensureWithinWorkspace(args.path);
          const text = fs.readFileSync(filePath, 'utf8');
          appendEvent(tool.name, { path: args.path });
          return { content: [{ type: 'text' as const, text }] };
        },
      );
      break;
    case 'write_workspace':
      server.tool(
        tool.name,
        tool.description,
        {
          path: z.string(),
          content: z.string(),
        },
        async (args) => {
          const filePath = ensureWithinWorkspace(args.path);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, args.content);
          appendEvent(tool.name, { path: args.path });
          return {
            content: [{ type: 'text' as const, text: `Wrote ${args.path}` }],
          };
        },
      );
      break;
    case 'bash':
      server.tool(
        tool.name,
        tool.description,
        {
          command: z.string(),
          timeoutMs: z.number().int().positive().max(300000).optional(),
        },
        async (args) => {
          const { stdout, stderr } = await execFileAsync(
            'bash',
            ['-lc', args.command],
            {
              cwd: manifest.workspaceDir,
              timeout: args.timeoutMs ?? 30_000,
              maxBuffer: 1024 * 1024,
            },
          );
          appendEvent(tool.name, { command: args.command });
          const output = [stdout.trim(), stderr.trim()]
            .filter((part) => part.length > 0)
            .join('\n');
          return {
            content: [{ type: 'text' as const, text: output || 'Command completed.' }],
          };
        },
      );
      break;
    case 'report_progress':
      server.tool(
        tool.name,
        tool.description,
        { message: z.string() },
        async (args) => {
          appendEvent(tool.name, { message: args.message });
          return {
            content: [{ type: 'text' as const, text: 'Progress recorded.' }],
          };
        },
      );
      break;
    case 'delegate_to_lead':
      server.tool(
        tool.name,
        tool.description,
        {
          leadId: z.string(),
          objective: z.string(),
          payloadJson: z.string().optional(),
        },
        async (args) => {
          appendEvent(tool.name, args);
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Delegation request recorded. Nested delegation is not yet supported in this runtime entrypoint.',
              },
            ],
          };
        },
      );
      break;
    case 'escalate_to_human':
      server.tool(
        tool.name,
        tool.description,
        {
          question: z.string(),
          contextJson: z.string().optional(),
        },
        async (args) => {
          appendEvent(tool.name, args);
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Escalation request recorded. Human escalation is not yet interactive in this runtime entrypoint.',
              },
            ],
          };
        },
      );
      break;
    default:
      server.tool(
        tool.name,
        tool.description,
        { inputJson: z.string().optional() },
        async (args) => {
          appendEvent(tool.name, args);
          return {
            content: [
              {
                type: 'text' as const,
                text: `${tool.name} executed.`,
              },
            ],
          };
        },
      );
      break;
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);
