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

/** The task locks t.test.ts, commits it itself, then an unrelated commit is pulled and the base moves. */
function pulledOverOwnCommit(): string {
  const repo = makeRepo();
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  writeFileSync(join(repo, 't.test.ts'), 'one\n');
  runLw(repo, ['lock', 't.test.ts']);
  runLw(repo, ['stage', 'build']);
  commitFile(repo, 't.test.ts', 'one\n');
  commitFile(repo, 'c.txt', 'pulled\n');
  runLw(repo, ['start', TASK, '--force', '--base', 'HEAD']);
  runLw(repo, ['stage', 'build']);
  return repo;
}

describe('brief pulledLocks for a locked test the task committed before the pull', () => {
  it('does not list it when the pull left it alone', () => {
    expect(brief(pulledOverOwnCommit())).not.toHaveProperty('pulledLocks');
  });

  it('does not list it when it is edited after the pull, and the edit stays in changed', () => {
    const repo = pulledOverOwnCommit();
    writeFileSync(join(repo, 't.test.ts'), 'edited\n');
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(JSON.parse(runLw(repo, ['check-locks']).stdout).changed).toEqual(['t.test.ts']);
  });
});
