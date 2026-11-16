import { writeFileSync } from 'node:fs';
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

/** Build has begun on a task that locked two committed files, a.txt and b.txt. */
function building(): string {
  const repo = makeRepo();
  commitFile(repo, 'b.txt', 'bee\n');
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  runLw(repo, ['lock', 'a.txt', 'b.txt']);
  runLw(repo, ['stage', 'build']);
  return repo;
}

const moveBase = (repo: string) => {
  expect(runLw(repo, ['start', TASK, '--force', '--base', 'HEAD']).code).toBe(0);
  runLw(repo, ['stage', 'build']);
};

describe('brief pulledLocks after the base moves over a locked file', () => {
  it('lists a locked file that a pulled commit changed', () => {
    const repo = building();
    commitFile(repo, 'a.txt', 'pulled\n');
    moveBase(repo);
    expect(brief(repo).pulledLocks).toEqual(['a.txt']);
    expect(locks(repo).changed).toContain('a.txt');
  });

  it('lists only the changed locked files when a pull touches one of two', () => {
    const repo = building();
    commitFile(repo, 'b.txt', 'pulled\n');
    commitFile(repo, 'c.txt', 'unlocked\n');
    moveBase(repo);
    expect(brief(repo).pulledLocks).toEqual(['b.txt']);
  });

  it('lists every locked file that a pull changed', () => {
    const repo = building();
    commitFile(repo, 'a.txt', 'pulled a\n');
    commitFile(repo, 'b.txt', 'pulled b\n');
    moveBase(repo);
    expect([...brief(repo).pulledLocks].sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('has no pulledLocks when the pull changed only files that are not locked', () => {
    const repo = building();
    commitFile(repo, 'c.txt', 'unlocked\n');
    moveBase(repo);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(locks(repo).ok).toBe(true);
  });

  it('has no pulledLocks once the changed file is re-locked to its pulled content', () => {
    const repo = building();
    commitFile(repo, 'a.txt', 'pulled\n');
    moveBase(repo);
    runLw(repo, ['reopen', 'test', 'a pulled commit changed a locked test']);
    expect(runLw(repo, ['lock', 'a.txt']).code).toBe(0);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(locks(repo).changed).toEqual([]);
  });

  it('stops listing a pulled file after a second base move over commits that leave it alone', () => {
    const repo = building();
    commitFile(repo, 'a.txt', 'pulled\n');
    moveBase(repo);
    commitFile(repo, 'c.txt', 'unlocked\n');
    moveBase(repo);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(locks(repo).changed).toContain('a.txt');
  });
});

describe('brief pulledLocks when the base does not move', () => {
  it('does not list a locked file edited in the working tree, which stays in changed', () => {
    const repo = building();
    writeFileSync(join(repo, 'a.txt'), 'edited by hand\n');
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    const out = runLw(repo, ['check-locks']);
    expect(out.code).toBe(1);
    expect(JSON.parse(out.stdout).changed).toEqual(['a.txt']);
  });

  it('does not list a locked file changed by a commit made before the task started', () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'older\n');
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['start', TASK, '--force']);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
  });

  it('does not list a locked file edited by hand after the base moved over unrelated commits', () => {
    const repo = building();
    commitFile(repo, 'c.txt', 'unlocked\n');
    moveBase(repo);
    writeFileSync(join(repo, 'a.txt'), 'edited by hand\n');
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(locks(repo).changed).toEqual(['a.txt']);
  });
});
