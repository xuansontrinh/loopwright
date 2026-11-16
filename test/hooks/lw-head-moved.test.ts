import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-08-x.md';
const REASON = 'the user said these commits are this task own work';

const brief = (repo: string) => JSON.parse(runLw(repo, ['brief', 'reviewer']).stdout);
const stateOf = (repo: string) => runLw(repo, ['status']).stdout;
const head = (repo: string) => git(repo, ['rev-parse', 'HEAD']);

function commitFile(repo: string, file: string, content: string): string {
  writeFileSync(join(repo, file), content);
  git(repo, ['add', file]);
  git(repo, ['commit', '-q', '-m', `edit ${file}`]);
  return head(repo);
}

/** A repo whose main branch tracks a bare origin, with a task started at the pushed HEAD. */
function tracking(): string {
  const repo = makeRepo();
  const origin = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-origin-')));
  git(origin, ['init', '-q', '--bare', '-b', 'main']);
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['push', '-q', '-u', 'origin', 'main']);
  runLw(repo, ['start', TASK]);
  return repo;
}

const pushed = (repo: string, file: string) => {
  const sha = commitFile(repo, file, `${file}\n`);
  git(repo, ['push', '-q']);
  return sha;
};

describe('brief headMoved', () => {
  it('is absent while HEAD is the base commit', () => {
    const repo = tracking();
    expect(brief(repo)).not.toHaveProperty('headMoved');
  });

  it('is absent when the new commits exist only locally', () => {
    const repo = tracking();
    commitFile(repo, 'own.txt', 'own\n');
    expect(brief(repo)).not.toHaveProperty('headMoved');
  });

  it('reports the base, the new HEAD and the commits when a new commit is on the upstream branch', () => {
    const repo = tracking();
    const base = head(repo);
    const sha = pushed(repo, 'pulled.txt');
    const moved = brief(repo).headMoved;
    expect(moved.from).toBe(base);
    expect(moved.to).toBe(sha);
    expect(moved.commits).toHaveLength(1);
    expect(JSON.stringify(moved.commits)).toContain(sha.slice(0, 7));
  });

  it('lists every commit between the base and HEAD when only some are on the upstream branch', () => {
    const repo = tracking();
    const first = pushed(repo, 'pulled.txt');
    const second = commitFile(repo, 'own.txt', 'own\n');
    const moved = brief(repo).headMoved;
    expect(moved.to).toBe(second);
    expect(moved.commits).toHaveLength(2);
    expect(JSON.stringify(moved.commits)).toContain(first.slice(0, 7));
    expect(JSON.stringify(moved.commits)).toContain(second.slice(0, 7));
  });

  it('is absent when the repo has neither an upstream branch nor origin/HEAD', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    commitFile(repo, 'own.txt', 'own\n');
    expect(brief(repo)).not.toHaveProperty('headMoved');
  });

  it('falls back to origin/HEAD when the branch has no upstream', () => {
    const repo = tracking();
    git(repo, ['branch', '--unset-upstream']);
    git(repo, ['remote', 'set-head', 'origin', 'main']);
    const sha = commitFile(repo, 'pulled.txt', 'pulled\n');
    git(repo, ['push', '-q', 'origin', 'main']);
    expect(brief(repo).headMoved?.to).toBe(sha);
  });

  it('is absent once the base moves to HEAD', () => {
    const repo = tracking();
    pushed(repo, 'pulled.txt');
    runLw(repo, ['start', TASK, '--force', '--base', 'HEAD']);
    expect(brief(repo)).not.toHaveProperty('headMoved');
  });
});

describe('keep-base', () => {
  it('records the current HEAD as answered, so headMoved is absent until HEAD moves again', () => {
    const repo = tracking();
    pushed(repo, 'pulled.txt');
    expect(brief(repo)).toHaveProperty('headMoved');
    const r = runLw(repo, ['keep-base', '--reason', REASON]);
    expect(r.code).toBe(0);
    expect(brief(repo)).not.toHaveProperty('headMoved');
    expect(brief(repo).baseCommit).not.toBe(head(repo));
  });

  it('reports headMoved again once HEAD moves past the answered commit', () => {
    const repo = tracking();
    pushed(repo, 'pulled.txt');
    runLw(repo, ['keep-base', '--reason', REASON]);
    const sha = pushed(repo, 'more.txt');
    expect(brief(repo).headMoved?.to).toBe(sha);
  });

  it('a missing --reason exits 1 with its own message and writes nothing', () => {
    const repo = tracking();
    pushed(repo, 'pulled.txt');
    const before = stateOf(repo);
    const r = runLw(repo, ['keep-base']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('keep-base');
    expect(r.stderr).toContain('--reason');
    expect(stateOf(repo)).toBe(before);
    expect(brief(repo)).toHaveProperty('headMoved');
  });

  it('a --reason without a value exits 1 with its own message and writes nothing', () => {
    const repo = tracking();
    pushed(repo, 'pulled.txt');
    const before = stateOf(repo);
    const r = runLw(repo, ['keep-base', '--reason']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--reason requires a value');
    expect(stateOf(repo)).toBe(before);
    expect(brief(repo)).toHaveProperty('headMoved');
  });

  it('no active task exits 1 with its own message and writes nothing', () => {
    const repo = makeRepo();
    const before = stateOf(repo);
    const r = runLw(repo, ['keep-base', '--reason', REASON]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no active task');
    expect(stateOf(repo)).toBe(before);
  });
});
