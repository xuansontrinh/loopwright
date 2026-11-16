import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-08-x.md';

const brief = (repo: string) => JSON.parse(runLw(repo, ['brief', 'implementer']).stdout);

function commitFile(repo: string, file: string): void {
  writeFileSync(join(repo, file), `${file}\n`);
  git(repo, ['add', file]);
  git(repo, ['commit', '-q', '-m', `edit ${file}`]);
}

describe('brief ownCommits', () => {
  it('is absent while HEAD is the base commit', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    expect(brief(repo)).not.toHaveProperty('ownCommits');
  });

  it('counts local-only commits since the base, which headMoved never reports', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    commitFile(repo, 'one.txt');
    commitFile(repo, 'two.txt');
    const b = brief(repo);
    expect(b.ownCommits).toBe(2);
    expect(b).not.toHaveProperty('headMoved');
  });

  it('is absent again once the base moves to HEAD', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    commitFile(repo, 'one.txt');
    runLw(repo, ['start', TASK, '--force', '--base', 'HEAD']);
    expect(brief(repo)).not.toHaveProperty('ownCommits');
  });

  it('is absent when no task is active', () => {
    expect(brief(makeRepo())).not.toHaveProperty('ownCommits');
  });
});
