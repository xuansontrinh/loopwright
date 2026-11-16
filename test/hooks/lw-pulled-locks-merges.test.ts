import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-08-x.md';

const brief = (repo: string) => JSON.parse(runLw(repo, ['brief', 'implementer']).stdout);
const locks = (repo: string) => JSON.parse(runLw(repo, ['check-locks']).stdout);

function commitFile(repo: string, file: string, content: string): void {
  writeFileSync(join(repo, file), content);
  git(repo, ['add', file]);
  git(repo, ['commit', '-q', '-m', `edit ${file}`]);
}

/**
 * A repo tracking an origin with a clone for upstream work. `forkBeforeTask` runs in the clone before the task starts,
 * the task then locks t.test.ts and moves to Build, and the repo's copy of t.test.ts is edited by hand without a re-lock.
 */
function build(forkBeforeTask?: (other: string) => void): { repo: string; other: string } {
  const repo = makeRepo();
  commitFile(repo, 't.test.ts', 'locked\n');
  const origin = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-origin-')));
  git(origin, ['init', '-q', '--bare', '-b', 'main']);
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['push', '-q', '-u', 'origin', 'main']);
  const other = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-clone-')));
  git(other, ['clone', '-q', origin, '.']);
  forkBeforeTask?.(other);
  git(repo, ['pull', '-q', '--no-rebase', '--no-edit']);
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  runLw(repo, ['lock', 't.test.ts']);
  runLw(repo, ['stage', 'build']);
  return { repo, other };
}

const handEdit = (repo: string) => writeFileSync(join(repo, 't.test.ts'), 'weakened\n');
const moveBase = (repo: string) => runLw(repo, ['start', TASK, '--force', '--base', 'HEAD']);

/** A feature branch forked in the clone before main edits t.test.ts, so the task starts after that edit. */
const oldFeatureBranch = (other: string) => {
  git(other, ['checkout', '-q', '-b', 'feat']);
  commitFile(other, 'f.txt', 'feature\n');
  git(other, ['checkout', '-q', 'main']);
  commitFile(other, 't.test.ts', 'edited upstream before the task\n');
  git(other, ['push', '-q']);
};

describe('pulledLocks lists only what the pulled commits changed', () => {
  it('an upstream merge commit of an old branch does not list a hand-edited locked test', () => {
    const { repo, other } = build(oldFeatureBranch);
    handEdit(repo);
    git(other, ['merge', '-q', '--no-ff', '--no-edit', 'feat']);
    git(other, ['push', '-q']);
    git(repo, ['pull', '-q', '--no-rebase', '--no-edit']);
    expect(moveBase(repo).code).toBe(0);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(locks(repo).changed).toEqual(['t.test.ts']);
  });

  it('an upstream merge commit of an old branch does not list a locked test the task edited in its own commit', () => {
    const { repo, other } = build(oldFeatureBranch);
    commitFile(repo, 't.test.ts', 'weakened locally\n');
    git(other, ['merge', '-q', '--no-ff', '--no-edit', 'feat']);
    git(other, ['push', '-q']);
    git(repo, ['pull', '-q', '--no-rebase', '--no-edit']);
    expect(moveBase(repo).code).toBe(0);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(locks(repo).changed).toEqual(['t.test.ts']);
  });

  it('keep-base --pulled after an upstream merge commit of an old branch lists nothing', () => {
    const { repo, other } = build(oldFeatureBranch);
    handEdit(repo);
    git(other, ['merge', '-q', '--no-ff', '--no-edit', 'feat']);
    git(other, ['push', '-q']);
    git(repo, ['pull', '-q', '--no-rebase', '--no-edit']);
    runLw(repo, ['keep-base', '--reason', 'pull approved', '--pulled']);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
  });

  it('an upstream merge commit of a branch that changed the locked test lists it', () => {
    const { repo, other } = build();
    git(other, ['checkout', '-q', '-b', 'feat']);
    commitFile(other, 't.test.ts', 'from the branch\n');
    git(other, ['checkout', '-q', 'main']);
    commitFile(other, 'm.txt', 'main\n');
    git(other, ['merge', '-q', '--no-ff', '--no-edit', 'feat']);
    git(other, ['push', '-q']);
    git(repo, ['pull', '-q', '--no-rebase', '--no-edit']);
    moveBase(repo);
    expect(brief(repo).pulledLocks).toEqual(['t.test.ts']);
  });

  it('an upstream merge commit that edits the locked test itself lists it', () => {
    const { repo, other } = build();
    git(other, ['checkout', '-q', '-b', 'feat']);
    commitFile(other, 'f.txt', 'feature\n');
    git(other, ['checkout', '-q', 'main']);
    commitFile(other, 'm.txt', 'main\n');
    git(other, ['merge', '-q', '--no-ff', '--no-commit', 'feat']);
    writeFileSync(join(other, 't.test.ts'), 'resolved in the merge\n');
    git(other, ['commit', '-q', '-am', 'merge feat']);
    git(other, ['push', '-q']);
    git(repo, ['pull', '-q', '--no-rebase', '--no-edit']);
    moveBase(repo);
    expect(brief(repo).pulledLocks).toEqual(['t.test.ts']);
  });

  it('a local merge from pull --no-rebase lists the upstream change, not the local-only commit', () => {
    const { repo, other } = build();
    commitFile(repo, 't.test.ts', 'weakened locally\n');
    commitFile(other, 'o.txt', 'upstream\n');
    git(other, ['push', '-q']);
    git(repo, ['pull', '-q', '--no-rebase', '--no-edit']);
    moveBase(repo);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(locks(repo).changed).toEqual(['t.test.ts']);
  });

  it('a local merge from pull --no-rebase lists a locked test the upstream commits changed', () => {
    const { repo, other } = build();
    commitFile(repo, 'own.txt', 'own\n');
    commitFile(other, 't.test.ts', 'pulled\n');
    git(other, ['push', '-q']);
    git(repo, ['pull', '-q', '--no-rebase', '--no-edit']);
    moveBase(repo);
    expect(brief(repo).pulledLocks).toEqual(['t.test.ts']);
  });

  it('a fast-forward pull lists a locked test the upstream commits changed', () => {
    const { repo, other } = build();
    commitFile(other, 't.test.ts', 'pulled\n');
    git(other, ['push', '-q']);
    git(repo, ['pull', '-q', '--ff-only']);
    moveBase(repo);
    expect(brief(repo).pulledLocks).toEqual(['t.test.ts']);
  });

  it('a rebase pull lists the upstream change, not the rebased local-only commit', () => {
    const { repo, other } = build();
    commitFile(repo, 't.test.ts', 'weakened locally\n');
    commitFile(other, 'o.txt', 'upstream\n');
    git(other, ['push', '-q']);
    git(repo, ['pull', '-q', '--rebase']);
    moveBase(repo);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(locks(repo).changed).toEqual(['t.test.ts']);
  });

  it('a rebase pull lists a locked test the upstream commits changed', () => {
    const { repo, other } = build();
    commitFile(repo, 'own.txt', 'own\n');
    commitFile(other, 't.test.ts', 'pulled\n');
    git(other, ['push', '-q']);
    git(repo, ['pull', '-q', '--rebase']);
    moveBase(repo);
    expect(brief(repo).pulledLocks).toEqual(['t.test.ts']);
  });

  it('an upstream edit that a later upstream commit reverts does not list a hand-edited locked test', () => {
    const { repo, other } = build();
    handEdit(repo);
    commitFile(other, 't.test.ts', 'pulled\n');
    commitFile(other, 't.test.ts', 'locked\n');
    git(other, ['push', '-q']);
    git(repo, ['stash', '-q']);
    git(repo, ['pull', '-q', '--ff-only']);
    git(repo, ['stash', 'pop', '-q']);
    moveBase(repo);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(locks(repo).changed).toEqual(['t.test.ts']);
  });
});
