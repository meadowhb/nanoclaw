import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureManagedTextFile } from './state-provisioner.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-provision-'));
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0, dirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('state-provisioner', () => {
  it('writes managed files and records a stable hash', () => {
    const dir = tempDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'CLAUDE.md');
    const hashPath = path.join(dir, '.claude', 'CLAUDE.md.sha256');

    const first = ensureManagedTextFile(filePath, '# Lead\n', hashPath);
    expect(first.changed).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('# Lead\n');

    const second = ensureManagedTextFile(filePath, '# Lead\n', hashPath);
    expect(second.changed).toBe(false);
    expect(second.hash).toBe(first.hash);
  });

  it('rejects drift in a managed file before overwriting it', () => {
    const dir = tempDir();
    dirs.push(dir);
    const filePath = path.join(dir, 'CLAUDE.md');
    const hashPath = path.join(dir, '.claude', 'CLAUDE.md.sha256');

    ensureManagedTextFile(filePath, '# Original\n', hashPath);
    fs.writeFileSync(filePath, '# Drifted\n');

    expect(() =>
      ensureManagedTextFile(filePath, '# Updated\n', hashPath),
    ).toThrow(/Managed file drift detected/);
  });
});
