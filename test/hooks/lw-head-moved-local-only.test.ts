import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-08-x.md';

const brief = (repo: string) => JSON.parse(runLw(repo, ['brief', 'reviewer']).stdout);

function commitFile(repo: string, file: string): string {
  writeFileSync(join(repo, file), `${file}\n`);
  git(repo, ['add', file]);
  git(repo, ['commit', '-q', '-m', `edit ${file}`]);
  return git(repo, ['rev-parse', 'HEAD']);
}

/** A repo tracking a bare origin, and a second clone of that origin to push upstream work from. */
function trackingRepo(): { repo: string; other: string } {
  const repo = makeRepo();
  const origin = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-origin-')));
  git(origin, ['init', '-q', '--bare', '-b', 'main']);
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['push', '-q', '-u', 'origin', 'main']);
  const other = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-other-')));
  git(other, ['clone', '-q', origin, '.']);
  return { repo, other };
}

function pushUpstream(other: string, file: string): void {
  commitFile(other, file);
  git(other, ['push', '-q']);
}

describe('brief headMoved localOnly', () => {
  it('is absent when every new commit is already on the upstream branch', () => {
    const { repo } = trackingRepo();
    runLw(repo, ['start', TASK]);
    commitFile(repo, 'pulled.txt');
    git(repo, ['push', '-q']);
    expect(brief(repo).headMoved).not.toHaveProperty('localOnly');
  });

  it('lists the task own local commit after a merge pull and leaves the merge commit out', () => {
    const { repo, other } = trackingRepo();
    runLw(repo, ['start', TASK]);
    const own = commitFile(repo, 'own.txt');
    pushUpstream(other, 'upstream.txt');
    git(repo, ['pull', '-q', '--no-rebase', '--no-edit']);
    const moved = brief(repo).headMoved;
    expect(moved.commits).toHaveLength(3);
    expect(moved.localOnly).toEqual([own.slice(0, 7)]);
  });

  it('does not count a merge commit that holds no work of the task', () => {
    const { repo, other } = trackingRepo();
    runLw(repo, ['start', TASK]);
    pushUpstream(other, 'upstream.txt');
    git(repo, ['pull', '-q', '--no-rebase', '--no-ff', '--no-edit']);
    const moved = brief(repo).headMoved;
    expect(moved.commits).toHaveLength(2);
    expect(moved).not.toHaveProperty('localOnly');
  });

  it('lists a task own commit that a rebase pull rewrote after an earlier both-kinds answer', () => {
    const { repo, other } = trackingRepo();
    runLw(repo, ['start', TASK]);
    commitFile(repo, 'own.txt');
    pushUpstream(other, 'upstream-one.txt');
    git(repo, ['pull', '-q', '--rebase']);
    expect(runLw(repo, ['keep-base', '--reason', 'both kinds', '--pulled']).code).toBe(0);
    pushUpstream(other, 'upstream-two.txt');
    git(repo, ['pull', '-q', '--rebase']);
    const moved = brief(repo).headMoved;
    expect(moved).not.toHaveProperty('keptEarlier');
    expect(moved.commits).toHaveLength(3);
    expect(moved.localOnly).toEqual([git(repo, ['rev-parse', '--short=7', 'HEAD'])]);
  });
});
