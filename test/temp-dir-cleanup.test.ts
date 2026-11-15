import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeDeadRunRoots } from './global-setup.js';

const root = resolve(__dirname, '..');
const vitestBin = join(root, 'node_modules', 'vitest', 'vitest.mjs');

let sandbox: string;

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-cleanup-sandbox-')));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 });
});

function runVitest(files: string[], probeEnv = true) {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('VITEST')) env[k] = v;
  Object.assign(env, { TMPDIR: sandbox, TEMP: sandbox, TMP: sandbox });
  if (probeEnv) env.LW_TEMP_CLEANUP_PROBE = '1';
  return spawnSync('node', [vitestBin, 'run', ...files.map((f) => `test/fixtures/temp-leak/${f}`)], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
}

function exitedPid(): number {
  const r = spawnSync('node', ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(r.stdout);
}

describe('temp dirs created by a test run', () => {
  it('are removed when tests use the shared helpers and direct mkdtemp', () => {
    const r = runVitest(['helpers-leak.test.ts']);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readdirSync(sandbox)).toEqual([]);
  }, 60_000);

  it('are removed together with sibling worktree folders', () => {
    const r = runVitest(['worktree-leak.test.ts']);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readdirSync(sandbox)).toEqual([]);
  }, 60_000);

  it('are removed when a test fails', () => {
    const r = runVitest(['failing-leak.test.ts']);
    expect(r.status, r.stdout + r.stderr).not.toBe(0);
    expect(readdirSync(sandbox)).toEqual([]);
  }, 60_000);
});

describe('run folders of dead processes', () => {
  function seed(): { dead: string; live: string } {
    const dead = join(sandbox, `lw-test-run-${exitedPid()}-x`);
    const live = join(sandbox, `lw-test-run-${process.pid}-y`);
    for (const d of [dead, live]) mkdirSync(join(d, 'nested'), { recursive: true });
    return { dead, live };
  }

  it('removeDeadRunRoots removes the folder of an exited process and keeps a live one', () => {
    const { dead, live } = seed();
    removeDeadRunRoots(sandbox);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  it('a starting run removes the folder of an exited process and keeps a live one', () => {
    const { dead, live } = seed();
    const r = runVitest(['helpers-leak.test.ts']);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
  }, 60_000);
});
