import { mkdtempSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function createTempGitRepo(prefix = 'lw-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

export function runCli(
  cwd: string,
  args: string[],
  opts: { home?: string; input?: string } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'lw-home-'));
  const r = spawnSync('node', [join(root, 'dist', 'cli.js'), ...args], {
    cwd,
    input: opts.input,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', HOME: home, USERPROFILE: home },
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.status ?? 1 };
}

export function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}
