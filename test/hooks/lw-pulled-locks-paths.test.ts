import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-08-x.md';

describe('brief pulledLocks with unusual paths', () => {
  it('lists a pulled locked file whose name holds non-ASCII characters', () => {
    const repo = makeRepo();
    const file = 'tést.txt';
    const commit = (content: string) => {
      writeFileSync(join(repo, file), content);
      git(repo, ['add', file]);
      git(repo, ['commit', '-q', '-m', 'edit']);
    };
    commit('original\n');
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', file]);
    runLw(repo, ['stage', 'build']);
    commit('pulled\n');
    runLw(repo, ['start', TASK, '--force', '--base', 'HEAD']);
    runLw(repo, ['stage', 'build']);
    expect(JSON.parse(runLw(repo, ['brief', 'implementer']).stdout).pulledLocks).toEqual([file]);
  });
});
