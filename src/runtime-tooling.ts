import path from 'path';

import type { LeadInstance } from './orchestration-types.js';
import type { SessionRuntimeContext } from './session-runtime.js';
import { ensureDirectory, writeJsonIfChanged } from './state-provisioner.js';

export interface SerializedRuntimeTool {
  name: string;
  description: string;
}

export interface RuntimeToolsManifest {
  workspaceDir: string;
  eventsPath: string;
  tools: SerializedRuntimeTool[];
}

export function buildSerializedRuntimeTools(
  context: SessionRuntimeContext,
): SerializedRuntimeTool[] {
  return context.mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

export function runtimeToolsHostPaths(instance: LeadInstance): {
  manifestPath: string;
  eventsPath: string;
} {
  const runtimeDir = path.join(instance.workspaceDir, '.nanoclaw');
  return {
    manifestPath: path.join(runtimeDir, 'runtime-tools.json'),
    eventsPath: path.join(runtimeDir, 'runtime-tool-events.jsonl'),
  };
}

export function runtimeToolsContainerPaths(): {
  manifestPath: string;
  eventsPath: string;
} {
  return {
    manifestPath: '/workspace/group/.nanoclaw/runtime-tools.json',
    eventsPath: '/workspace/group/.nanoclaw/runtime-tool-events.jsonl',
  };
}

export function writeRuntimeToolsManifest(
  manifestPath: string,
  manifest: RuntimeToolsManifest,
): void {
  ensureDirectory(path.dirname(manifestPath));
  writeJsonIfChanged(manifestPath, manifest);
}
