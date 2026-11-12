import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-08-x.md';
const checkLocks = (repo: string) => JSON.parse(runLw(repo, ['check-locks']).stdout);

function built(): string {
  const repo = makeRepo();
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  runLw(repo, ['lock', 'a.txt']);
  runLw(repo, ['stage', 'build']);
  return repo;
}

function relock(repo: string): void {
  writeFileSync(join(repo, 'a.txt'), 'rewritten\n');
  runLw(repo, ['lock', 'a.txt']);
  runLw(repo, ['stage', 'build']);
}

describe('check-locks reopen sanction', () => {
  it('a reopen without a preceding resume leaves its re-lock in lockedAfterBuild', () => {
    const repo = built();
    runLw(repo, ['reopen', 'test', 'tidy test']);
    relock(repo);
    const out = checkLocks(repo);
    expect(out.lockedAfterBuild).toEqual(['a.txt']);
    expect(out.relockedAfterReopen).toEqual([]);
  });

  it('await-user, resume, reopen sanctions the re-lock with its reason', () => {
    const repo = built();
    runLw(repo, ['await-user', 'deviation']);
    runLw(repo, ['resume']);
    runLw(repo, ['reopen', 'test', 'user chose to go back']);
    relock(repo);
    const out = checkLocks(repo);
    expect(out.lockedAfterBuild).toEqual([]);
    expect(out.relockedAfterReopen).toEqual([{ path: 'a.txt', reason: 'user chose to go back' }]);
  });

  it('a resume followed by another event before the reopen does not sanction it', () => {
    const repo = built();
    runLw(repo, ['await-user', 'deviation']);
    runLw(repo, ['resume']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['reopen', 'test', 'later']);
    relock(repo);
    expect(checkLocks(repo).lockedAfterBuild).toEqual(['a.txt']);
  });

  it('a lone resume before the reopen does not sanction it', () => {
    const repo = built();
    runLw(repo, ['resume']);
    runLw(repo, ['reopen', 'test', 'tidy test']);
    relock(repo);
    const out = checkLocks(repo);
    expect(out.lockedAfterBuild).toEqual(['a.txt']);
    expect(out.relockedAfterReopen).toEqual([]);
  });

  it('a stage build between resume and reopen does not sanction it', () => {
    const repo = built();
    runLw(repo, ['await-user', 'deviations in build']);
    runLw(repo, ['resume']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['reopen', 'test', 'tidy test']);
    relock(repo);
    const out = checkLocks(repo);
    expect(out.lockedAfterBuild).toEqual(['a.txt']);
    expect(out.relockedAfterReopen).toEqual([]);
  });

  it('a bare reopen after a sanctioned one does not withdraw the sanction', () => {
    const repo = built();
    runLw(repo, ['await-user', 'deviation']);
    runLw(repo, ['resume']);
    runLw(repo, ['reopen', 'plan', 'real reason']);
    runLw(repo, ['reopen', 'test', 'bare']);
    relock(repo);
    expect(checkLocks(repo).relockedAfterReopen).toEqual([{ path: 'a.txt', reason: 'real reason' }]);
  });
});
