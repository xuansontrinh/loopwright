import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const LW = resolve(__dirname, '../../content/hooks/lw.mjs');

/** Read a JSON fixture, replacing /REPO in every string (escaping-safe for Windows paths). */
export function loadFixture(path: string, repo: string): any {
  const walk = (v: unknown): unknown =>
    typeof v === 'string'
      ? v.split('/REPO').join(repo)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return walk(JSON.parse(readFileSync(path, 'utf8')));
}

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** A committed repo with no .loopwright/ (fresh clone / global install). */
export function makeBareRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-hooks-')));
  git(dir, ['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

export function makeRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-hooks-')));
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

/** Process env with HOME and USERPROFILE pointing at a fresh temp dir, so hooks never read or write the real home. */
export function isolatedEnv(env?: Record<string, string>): NodeJS.ProcessEnv {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-home-')));
  return { ...process.env, HOME: home, USERPROFILE: home, ...env };
}

export function runLw(cwd: string, args: string[], input?: string, env?: Record<string, string>) {
  const r = spawnSync('node', [LW, ...args], { cwd, encoding: 'utf8', input, env: isolatedEnv(env) });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
