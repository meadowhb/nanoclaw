import fs from 'fs';
import path from 'path';

import { DATA_DIR, GROUPS_DIR } from './config.js';
import { buildLeadInstance } from './lead-instances.js';
import type {
  LeadBlueprint,
  LeadInstance,
} from './orchestration-types.js';
import {
  ensureDirectory,
  ensureManagedTextFile,
  writeJsonIfChanged,
} from './state-provisioner.js';

export interface NanoclawProvisionerOptions {
  dataDir?: string;
  groupsDir?: string;
  sessionsDir?: string;
  buildClaudeMd?: (blueprint: LeadBlueprint) => string;
}

function buildLeadClaudeMd(blueprint: LeadBlueprint): string {
  const runtime = blueprint.runtime;
  const allowedTools = runtime?.allowedTools.join(', ') || 'none';
  const executionMode = runtime?.executionMode ?? 'in_process';

  return [
    `# ${blueprint.leadId}`,
    '',
    `Team: ${blueprint.team}`,
    `Model: ${blueprint.model}`,
    `Execution mode: ${executionMode}`,
    `Allowed tools: ${allowedTools}`,
    '',
    'Operating posture:',
    blueprint.soul,
    '',
    'Contract:',
    '- Work inside the provided workspace.',
    '- Preserve continuity across resumptions.',
    '- Return concise, decision-ready outputs.',
    '',
  ].join('\n');
}

function ensureDirectoryLink(targetPath: string, linkPath: string): void {
  ensureDirectory(path.dirname(linkPath));

  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink() && fs.readlinkSync(linkPath) === targetPath) {
      return;
    }
    fs.rmSync(linkPath, { recursive: true, force: true });
  } catch {
    // ignore missing bridge path
  }

  fs.symlinkSync(targetPath, linkPath, 'dir');
}

export class NanoclawProvisioner {
  private readonly dataDir: string;
  private readonly groupsDir: string;
  private readonly sessionsDir: string;
  private readonly buildClaudeMd: (blueprint: LeadBlueprint) => string;

  constructor(options: NanoclawProvisionerOptions = {}) {
    this.dataDir = options.dataDir ?? DATA_DIR;
    this.groupsDir = options.groupsDir ?? GROUPS_DIR;
    this.sessionsDir = options.sessionsDir ?? path.join(this.dataDir, 'sessions');
    this.buildClaudeMd = options.buildClaudeMd ?? buildLeadClaudeMd;
  }

  provision(blueprint: LeadBlueprint): LeadInstance {
    const instance = buildLeadInstance(this.dataDir, blueprint);

    ensureDirectory(instance.workspaceDir);
    ensureDirectory(instance.claudeDir);
    ensureManagedTextFile(
      instance.claudeMdPath,
      this.buildClaudeMd(blueprint),
      instance.managedHashPath,
    );
    writeJsonIfChanged(instance.settingsPath, {
      runtime: blueprint.runtime,
      leadId: blueprint.leadId,
    });

    ensureDirectoryLink(
      instance.workspaceDir,
      path.join(this.groupsDir, instance.bridgeGroupFolder),
    );

    const bridgeSessionDir = path.join(this.sessionsDir, instance.bridgeGroupFolder);
    ensureDirectory(bridgeSessionDir);
    ensureDirectoryLink(instance.claudeDir, path.join(bridgeSessionDir, '.claude'));

    return instance;
  }
}

export { buildLeadClaudeMd };
