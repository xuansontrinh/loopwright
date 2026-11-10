import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const spawned = vi.hoisted(() => ({ envs: [] as Array<Record<string, string | undefined>> }));
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: ((cmd: string, args: readonly string[], options: any) => {
      spawned.envs.push(options?.env ?? {});
      return actual.spawnSync(cmd, args as string[], options);
    }) as typeof actual.spawnSync,
  };
});

import { createTempGitRepo, runCli } from './helpers.js';
import { makeBareRepo, runLw } from './hooks/helpers.js';

const last = () => spawned.envs[spawned.envs.length - 1];

describe('test helpers home isolation', () => {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('AC6: runCli sets HOME and USERPROFILE to the same isolated home', () => {
    const repo = createTempGitRepo('lw-h-');
    const realish = mkdtempSync(join(tmpdir(), 'lw-real-'));
    process.env.HOME = realish;
    process.env.USERPROFILE = realish;
    runCli(repo, ['--help']);
    const env = last();
    expect(env.HOME).toBeTruthy();
    expect(env.USERPROFILE).toBe(env.HOME);
    expect(env.HOME).not.toBe(realish);
  });

  it('AC6: runCli honors opts.home for both variables', () => {
    const repo = createTempGitRepo('lw-h-');
    const home = mkdtempSync(join(tmpdir(), 'lw-given-'));
    runCli(repo, ['--help'], { home });
    expect(last().HOME).toBe(home);
    expect(last().USERPROFILE).toBe(home);
  });

  it('AC6: init --global leaves the real home untouched', () => {
    const repo = createTempGitRepo('lw-h-');
    const realish = mkdtempSync(join(tmpdir(), 'lw-real-'));
    process.env.HOME = realish;
    process.env.USERPROFILE = realish;
    runCli(repo, ['init', '--global']);
    expect(readdirSync(realish)).toEqual([]);
    expect(last().USERPROFILE).not.toBe(realish);
  });

  it('AC7: runLw without env gets an isolated HOME and USERPROFILE', () => {
    const repo = makeBareRepo();
    const realish = mkdtempSync(join(tmpdir(), 'lw-real-'));
    process.env.HOME = realish;
    process.env.USERPROFILE = realish;
    runLw(repo, ['status']);
    const env = last();
    expect(env.HOME).toBeTruthy();
    expect(env.USERPROFILE).toBe(env.HOME);
    expect(env.HOME).not.toBe(realish);
  });

  it('AC7: runLw keeps explicitly passed env values', () => {
    const repo = makeBareRepo();
    const home = mkdtempSync(join(tmpdir(), 'lw-given-'));
    runLw(repo, ['status'], undefined, { HOME: home, USERPROFILE: home });
    expect(last().HOME).toBe(home);
    expect(last().USERPROFILE).toBe(home);
  });
});
