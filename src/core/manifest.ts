import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Manifest {
  version: 1;
  mode: 'repo' | 'global';
  files: { path: string; sha256: string }[];
  config: { file: string; kind: 'claude-hooks' | 'codex-block' }[];
  /** Install options recorded at init/update, reused by update. */
  options?: { hook: boolean; symlink: boolean };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function readManifest(path: string): Manifest | null {
  if (!existsSync(path)) return null;
  try {
    const m = JSON.parse(readFileSync(path, 'utf-8')) as Manifest;
    if (m && m.version === 1 && Array.isArray(m.files)) {
      return { ...m, config: Array.isArray(m.config) ? m.config : [] };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeManifest(path: string, m: Manifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(m, null, 2) + '\n', 'utf-8');
}
