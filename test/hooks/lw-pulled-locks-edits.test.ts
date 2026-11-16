import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-08-x.md';

const brief = (repo: string) => JSON.parse(runLw(repo, ['brief', 'implementer']).stdout);

function commitFile(repo: string, file: string, content: string): void {
  writeFileSync(join(repo, file), content);
  git(repo, ['add', file]);
  git(repo, ['commit', '-q', '-m', `edit ${file}`]);
}

/** A task that locked a.txt, then a pull changed it and the base moved over the pull. */
function pulled(file = 'a.txt'): string {
  const repo = makeRepo();
  commitFile(repo, file, 'original\n');
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  runLw(repo, ['lock', file]);
  runLw(repo, ['stage', 'build']);
  commitFile(repo, file, 'pulled\n');
  runLw(repo, ['start', TASK, '--force', '--base', 'HEAD']);
  runLw(repo, ['stage', 'build']);
  return repo;
}

describe('brief pulledLocks after a pull was handled', () => {
  it('does not list a file the implementer edited after its pulled version was re-locked', () => {
    const repo = pulled();
    expect(brief(repo).pulledLocks).toEqual(['a.txt']);
    runLw(repo, ['reopen', 'test', 'a pulled commit changed a locked test']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    writeFileSync(join(repo, 'a.txt'), 'tampered by implementer\n');
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(JSON.parse(runLw(repo, ['check-locks']).stdout).changed).toEqual(['a.txt']);
  });

  it('lists a pulled file that holds task edits merged with the pulled change', () => {
    const repo = pulled();
    writeFileSync(join(repo, 'a.txt'), 'pulled\nplus the task edit\n');
    expect(brief(repo).pulledLocks).toEqual(['a.txt']);
  });

  it('does not list a pulled file whose content matches its lock again', () => {
    const repo = pulled();
    expect(brief(repo).pulledLocks).toEqual(['a.txt']);
    writeFileSync(join(repo, 'a.txt'), 'original\n');
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
  });

  it('does not list a locked file the pull did not touch', () => {
    const repo = pulled();
    commitFile(repo, 'b.txt', 'other\n');
    runLw(repo, ['reopen', 'test', 'a pulled commit changed a locked test']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['start', TASK, '--force', '--base', 'HEAD']);
    runLw(repo, ['stage', 'build']);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
  });

  it('lists a pulled file again after a second pull moved the base', () => {
    const repo = pulled();
    runLw(repo, ['reopen', 'test', 'a pulled commit changed a locked test']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    commitFile(repo, 'a.txt', 'pulled again\n');
    runLw(repo, ['start', TASK, '--force', '--base', 'HEAD']);
    runLw(repo, ['stage', 'build']);
    expect(brief(repo).pulledLocks).toEqual(['a.txt']);
  });

  it('lists a pulled file whose path has upper-case letters', () => {
    const repo = pulled('Button.test.tsx');
    // Lock paths are lower-cased on win32.
    const lockPath = process.platform === 'win32' ? 'button.test.tsx' : 'Button.test.tsx';
    expect(brief(repo).pulledLocks).toEqual([lockPath]);
  });
});
