import { createHash } from 'node:crypto';
import fs from 'fs';
import path from 'path';

export interface ManagedTextFileResult {
  changed: boolean;
  hash: string;
}

export function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function ensureManagedTextFile(
  filePath: string,
  content: string,
  hashPath: string,
): ManagedTextFileResult {
  ensureDirectory(path.dirname(filePath));
  ensureDirectory(path.dirname(hashPath));

  const nextHash = contentHash(content);
  const fileExists = fs.existsSync(filePath);
  const hashExists = fs.existsSync(hashPath);

  if (!fileExists) {
    fs.writeFileSync(filePath, content);
    fs.writeFileSync(hashPath, `${nextHash}\n`);
    return { changed: true, hash: nextHash };
  }

  const currentContent = fs.readFileSync(filePath, 'utf8');
  const currentHash = contentHash(currentContent);
  const managedHash = hashExists
    ? fs.readFileSync(hashPath, 'utf8').trim()
    : '';

  if (managedHash.length > 0 && currentHash !== managedHash) {
    throw new Error(`Managed file drift detected at ${filePath}`);
  }

  if (currentHash === nextHash) {
    if (!hashExists || managedHash !== nextHash) {
      fs.writeFileSync(hashPath, `${nextHash}\n`);
    }
    return { changed: false, hash: nextHash };
  }

  if (managedHash.length === 0) {
    throw new Error(`Refusing to overwrite unmanaged file at ${filePath}`);
  }

  fs.writeFileSync(filePath, content);
  fs.writeFileSync(hashPath, `${nextHash}\n`);
  return { changed: true, hash: nextHash };
}

export function writeJsonIfChanged(filePath: string, value: unknown): boolean {
  ensureDirectory(path.dirname(filePath));
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === next) {
    return false;
  }
  fs.writeFileSync(filePath, next);
  return true;
}
