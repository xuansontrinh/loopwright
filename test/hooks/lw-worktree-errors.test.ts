import { existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

describe('worktree: refusing bad input before git changes anything', () => {
  it('rejects an unknown --base with its own message and creates nothing', () => {
    const repo = makeRepo();
    const before = git(repo, ['worktree', 'list']);
    const r = runLw(repo, ['worktree', 'bad base', '--base', 'no-such-ref'], 'Goal.');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("worktree: unknown base 'no-such-ref'");
    expect(git(repo, ['worktree', 'list'])).toBe(before);
    expect(existsSync(join(dirname(repo), `${basename(repo)}-bad-base`))).toBe(false);
  });

  it('rejects a --stub that is not proposed and leaves it untouched', () => {
    const repo = makeRepo();
    const text = '# Active\n\nkind: feature\nstatus: active\nstage: build\n\n## Goal\nx\n';
    writeFileSync(join(repo, '.loopwright/tasks/a.md'), text);
    const before = git(repo, ['worktree', 'list']);
    const r = runLw(repo, ['worktree', 'not a stub', '--stub', 'tasks/a.md'], 'Goal.');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('worktree: tasks/a.md is not a proposed stub');
    expect(git(repo, ['worktree', 'list'])).toBe(before);
  });
});
