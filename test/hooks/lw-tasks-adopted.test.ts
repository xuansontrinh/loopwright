import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

const stateId = (p: string) => createHash('sha256').update(p).digest('hex').slice(0, 12);

function olderLayout(status = 'active') {
  const repo = makeRepo();
  const wt = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-wt-'))), 'wt');
  git(repo, ['worktree', 'add', '-q', '-b', 'feat', wt]);
  writeFileSync(
    join(repo, '.loopwright/tasks/old.md'),
    `# Old task\n\nkind: feature\nstatus: ${status}\nstage: build\nworktree: ${wt} (branch feat)\n\n## Goal\nG\n`,
  );
  const state = {
    version: 1,
    task: 'tasks/old.md',
    stage: 'build',
    baseCommit: git(repo, ['rev-parse', 'HEAD']),
    worktree: wt,
    branch: 'feat',
    lockedTests: [],
    verdict: null,
    stopBlocks: 0,
    history: [],
  };
  mkdirSync(join(repo, '.loopwright/state'), { recursive: true });
  writeFileSync(join(repo, '.loopwright/state', `${stateId(wt)}.json`), JSON.stringify(state));
  return { repo, wt };
}

describe('tasks: main-checkout state left behind', () => {
  it('does not list an adopted task as worktree gone once its worktree is removed', () => {
    const { repo, wt } = olderLayout();
    expect(runLw(wt, ['adopt', 'tasks/old.md']).code).toBe(0);
    expect(runLw(wt, ['done']).code).toBe(0);
    git(repo, ['worktree', 'remove', '--force', wt]);
    const r = runLw(repo, ['tasks']);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).worktreeGone).toEqual([]);
  });

  it('still lists an unadopted older-layout task as worktree gone once its worktree is removed', () => {
    const { repo, wt } = olderLayout();
    git(repo, ['worktree', 'remove', '--force', wt]);
    const gone = JSON.parse(runLw(repo, ['tasks']).stdout).worktreeGone;
    expect(gone.map((g: { task: string }) => g.task)).toEqual(['tasks/old.md']);
  });
});
