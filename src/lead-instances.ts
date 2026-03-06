import path from 'path';

import type { LeadBlueprint, LeadInstance } from './orchestration-types.js';

export function sanitizeLeadInstanceSegment(leadId: string): string {
  return leadId.replace(/[^A-Za-z0-9_-]/g, '-');
}

export function buildLeadInstance(
  dataDir: string,
  blueprint: LeadBlueprint,
): LeadInstance {
  const slug = sanitizeLeadInstanceSegment(blueprint.leadId);
  const rootDir = path.join(dataDir, 'leads', slug);

  return {
    leadId: blueprint.leadId,
    blueprint,
    rootDir,
    workspaceDir: path.join(rootDir, 'workspace'),
    claudeDir: path.join(rootDir, '.claude'),
    claudeMdPath: path.join(rootDir, 'workspace', 'CLAUDE.md'),
    managedHashPath: path.join(rootDir, '.claude', 'CLAUDE.md.sha256'),
    settingsPath: path.join(rootDir, '.claude', 'settings.json'),
    bridgeGroupFolder: `lead-${slug}`,
  };
}
