import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeBareRepo, runLw } from './helpers.js';

const env = () => {
  const h = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-explore-dirty-home-')));
  return { HOME: h, USERPROFILE: h };
};
const explore = (repo: string, args: string[] = ['.']) => {
  const r = runLw(repo, ['explore', ...args], undefined, env());
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
};
const runMd = (repo: string, dir: string) => readFileSync(join(repo, '.loopwright', dir, 'run.md'), 'utf8');
const dirty = (repo: string) => {
  writeFileSync(join(repo, 'a.txt'), 'changed\n');
  mkdirSync(join(repo, 'src/deep'), { recursive: true });
  writeFileSync(join(repo, 'src/deep/new.txt'), 'new\n');
  writeFileSync(join(repo, 'z-new.txt'), 'new\n');
};

describe('lw.mjs explore: dirty working tree', () => {
  it('reports an empty dirty list for a clean tree', () => {
    const repo = makeBareRepo();
    expect(explore(repo).dirty).toEqual([]);
  });

  it('lists changed and untracked files sorted, never .loopwright run folders', () => {
    const repo = makeBareRepo();
    dirty(repo);
    expect(explore(repo).dirty).toEqual(['a.txt', 'src/deep/new.txt', 'z-new.txt']);
  });

  it('reads the current tree again when resuming', () => {
    const repo = makeBareRepo();
    const first = explore(repo);
    expect(first.dirty).toEqual([]);
    dirty(repo);
    const second = explore(repo);
    expect(second.resume).toBe(true);
    expect(second.dirty).toEqual(['a.txt', 'src/deep/new.txt', 'z-new.txt']);
  });

  it('writes dirty: yes to run.md of a new run on a dirty tree', () => {
    const repo = makeBareRepo();
    dirty(repo);
    const out = explore(repo);
    expect(runMd(repo, out.dir)).toMatch(/^dirty: yes$/m);
  });

  it('writes dirty: no to run.md of a new run on a clean tree', () => {
    const repo = makeBareRepo();
    const out = explore(repo);
    expect(runMd(repo, out.dir)).toMatch(/^dirty: no$/m);
  });
});
