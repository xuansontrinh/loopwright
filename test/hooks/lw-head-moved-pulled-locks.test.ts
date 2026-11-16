import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-08-x.md';

const brief = (repo: string) => JSON.parse(runLw(repo, ['brief', 'reviewer']).stdout);
const locks = (repo: string) => JSON.parse(runLw(repo, ['check-locks']).stdout);

function commitFile(repo: string, file: string, content: string): void {
  writeFileSync(join(repo, file), content);
  git(repo, ['add', file]);
  git(repo, ['commit', '-q', '-m', `edit ${file}`]);
}

/** Tracks an origin; the task locked t.test.ts, built, committed own work and answered 'own commits'. */
function keptOwnCommits(): string {
  const repo = makeRepo();
  commitFile(repo, 't.test.ts', 'locked\n');
  const origin = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-origin-')));
  git(origin, ['init', '-q', '--bare', '-b', 'main']);
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['push', '-q', '-u', 'origin', 'main']);
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  runLw(repo, ['lock', 't.test.ts']);
  runLw(repo, ['stage', 'build']);
  commitFile(repo, 'own.txt', 'own\n');
  git(repo, ['push', '-q']);
  expect(runLw(repo, ['keep-base', '--reason', 'own work']).code).toBe(0);
  return repo;
}

describe('keep-base --pulled', () => {
  it('lists a locked test that the commits since the earlier answer changed', () => {
    const repo = keptOwnCommits();
    commitFile(repo, 't.test.ts', 'pulled\n');
    git(repo, ['push', '-q']);
    expect(brief(repo).headMoved.keptEarlier).toBe(true);
    expect(runLw(repo, ['keep-base', '--reason', 'both kinds', '--pulled']).code).toBe(0);
    expect(brief(repo).pulledLocks).toEqual(['t.test.ts']);
    expect(locks(repo).changed).toEqual(['t.test.ts']);
  });

  it('does not list a locked test that only the earlier answered commits changed', () => {
    const repo = keptOwnCommits();
    commitFile(repo, 't.test.ts', 'own edit\n');
    git(repo, ['push', '-q']);
    runLw(repo, ['keep-base', '--reason', 'own edit']);
    commitFile(repo, 'later.txt', 'pulled\n');
    git(repo, ['push', '-q']);
    runLw(repo, ['keep-base', '--reason', 'both kinds', '--pulled']);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
  });

  it('stops listing the file once it is re-locked', () => {
    const repo = keptOwnCommits();
    commitFile(repo, 't.test.ts', 'pulled\n');
    git(repo, ['push', '-q']);
    runLw(repo, ['keep-base', '--reason', 'both kinds', '--pulled']);
    runLw(repo, ['reopen', 'test', 'pull']);
    runLw(repo, ['lock', 't.test.ts']);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
  });

  it('without --pulled a changed locked test stays Blocking and is not listed', () => {
    const repo = keptOwnCommits();
    commitFile(repo, 't.test.ts', 'own edit\n');
    git(repo, ['push', '-q']);
    runLw(repo, ['keep-base', '--reason', 'own work again']);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(locks(repo).changed).toEqual(['t.test.ts']);
  });

  it('lists nothing when the new commits changed no locked test', () => {
    const repo = keptOwnCommits();
    commitFile(repo, 'other.txt', 'pulled\n');
    git(repo, ['push', '-q']);
    runLw(repo, ['keep-base', '--reason', 'both kinds', '--pulled']);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
  });
});
