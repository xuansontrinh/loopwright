import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

const stubOf = (repo: string, args: string[]) => {
  const r = runLw(repo, ['worktree', 'Fix login crash', ...args], 'Login crashes.');
  expect(r.code).toBe(0);
  const out = JSON.parse(r.stdout) as { worktree: string; stub: string };
  return readFileSync(join(out.worktree, '.loopwright', out.stub), 'utf8');
};

describe('worktree --kind', () => {
  it('writes kind: fix into the stub', () => {
    expect(stubOf(makeRepo(), ['--kind', 'fix'])).toMatch(/^kind: fix$/m);
  });

  it('defaults to kind: feature', () => {
    expect(stubOf(makeRepo(), [])).toMatch(/^kind: feature$/m);
  });

  it('rejects another kind with its own message and creates nothing', () => {
    const repo = makeRepo();
    const before = git(repo, ['worktree', 'list']);
    const r = runLw(repo, ['worktree', 'Odd kind', '--kind', 'chore'], 'Goal.');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('worktree "<title>"');
    expect(r.stderr).toContain('kind must be feature or fix');
    expect(git(repo, ['worktree', 'list'])).toBe(before);
  });
});
