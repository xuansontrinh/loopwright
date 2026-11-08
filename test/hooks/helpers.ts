import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const LW = resolve(__dirname, '../../content/hooks/lw.mjs');

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** A committed repo with no .loopwright/ (fresh clone / global install). */
export function makeBareRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lw-hooks-')));
  git(dir, ['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

export function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lw-hooks-')));
  git(dir, ['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  scaffoldLoopwright(dir);
  return dir;
}

export function scaffoldLoopwright(dir: string): void {
  const lw = join(dir, '.loopwright');
  mkdirSync(join(lw, 'state'), { recursive: true });
  mkdirSync(join(lw, 'tasks'), { recursive: true });
  writeFileSync(join(lw, '.gitignore'), '*\n');
}

export function runLw(cwd: string, args: string[], input?: string, env?: Record<string, string>) {
  const r = spawnSync('node', [LW, ...args], { cwd, encoding: 'utf8', input, env: env ? { ...process.env, ...env } : process.env });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
