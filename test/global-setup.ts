import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PREFIX = 'lw-test-run-';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function remove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    console.warn(`could not remove test temp folder ${path}: ${(e as Error).message}`);
  }
}

export function removeDeadRunRoots(dir: string): void {
  for (const name of readdirSync(dir)) {
    const pid = name.startsWith(PREFIX) ? Number(name.slice(PREFIX.length).split('-')[0]) : NaN;
    if (Number.isInteger(pid) && !isAlive(pid)) remove(join(dir, name));
  }
}

// One root per run: workers and child processes inherit it as their temp dir, so a single removal
// also covers dirs made outside any test's own cleanup (worktrees next to a repo, killed children).
export default function setup(): () => void {
  const base = realpathSync.native(tmpdir());
  removeDeadRunRoots(base);
  const root = mkdtempSync(join(base, `${PREFIX}${process.pid}-`));
  for (const key of ['TMPDIR', 'TEMP', 'TMP']) process.env[key] = root;
  return () => remove(root);
}
