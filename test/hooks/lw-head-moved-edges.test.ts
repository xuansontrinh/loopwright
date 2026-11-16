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

function trackingRepo(): string {
  const repo = makeRepo();
  const origin = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-origin-')));
  git(origin, ['init', '-q', '--bare', '-b', 'main']);
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['push', '-q', '-u', 'origin', 'main']);
  return repo;
}

describe('brief headMoved edge cases', () => {
  it('is absent when HEAD sits behind the base, with no commits between them', () => {
    const repo = trackingRepo();
    commitFile(repo, 'own.txt');
    runLw(repo, ['start', TASK]);
    git(repo, ['reset', '-q', '--soft', 'HEAD~1']);
    expect(brief(repo)).not.toHaveProperty('headMoved');
  });

  it('does not list or ask about answered commits again after a later local-only commit', () => {
    const repo = trackingRepo();
    runLw(repo, ['start', TASK]);
    commitFile(repo, 'pulled.txt');
    git(repo, ['push', '-q']);
    expect(brief(repo)).toHaveProperty('headMoved');
    runLw(repo, ['keep-base', '--reason', 'own work']);
    commitFile(repo, 'own.txt');
    expect(brief(repo)).not.toHaveProperty('headMoved');
  });

  it('asks again when a commit made after the answer is on the upstream branch, listing only the new commits', () => {
    const repo = trackingRepo();
    runLw(repo, ['start', TASK]);
    commitFile(repo, 'first.txt');
    git(repo, ['push', '-q']);
    runLw(repo, ['keep-base', '--reason', 'own work']);
    const second = commitFile(repo, 'second.txt');
    git(repo, ['push', '-q']);
    const moved = brief(repo).headMoved;
    expect(moved.to).toBe(second);
    expect(moved.commits).toHaveLength(1);
  });

  it('flags keptEarlier once an earlier answer kept commits, so a pull on top is not taken for the whole branch', () => {
    const repo = trackingRepo();
    runLw(repo, ['start', TASK]);
    commitFile(repo, 'own.txt');
    git(repo, ['push', '-q']);
    expect(brief(repo).headMoved).not.toHaveProperty('keptEarlier');
    runLw(repo, ['keep-base', '--reason', 'own work']);
    commitFile(repo, 'pulled.txt');
    git(repo, ['push', '-q']);
    const moved = brief(repo).headMoved;
    expect(moved.keptEarlier).toBe(true);
    expect(moved.commits).toHaveLength(1);
  });
});
