import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/** A repo tracking an origin, with the task in Build and t.test.ts locked; `upstream` pushes a commit from a clone. */
function build(): { repo: string; upstream: (file: string, content: string) => void } {
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
  const other = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-clone-')));
  git(other, ['clone', '-q', origin, '.']);
  const upstream = (file: string, content: string) => {
    commitFile(other, file, content);
    git(other, ['push', '-q']);
  };
  return { repo, upstream };
}

const pull = (repo: string) => git(repo, ['pull', '-q', '--no-rebase', '--no-edit']);

describe('pulledLocks counts only commits on the upstream branch', () => {
  it('keep-base --pulled does not list a locked test edited in a local-only commit', () => {
    const { repo, upstream } = build();
    commitFile(repo, 't.test.ts', 'weakened\n');
    upstream('other.txt', 'pulled\n');
    pull(repo);
    expect(runLw(repo, ['keep-base', '--reason', 'pull approved', '--pulled']).code).toBe(0);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(locks(repo).changed).toEqual(['t.test.ts']);
  });

  it('keep-base --pulled lists a locked test the pulled commits changed, next to a local-only commit', () => {
    const { repo, upstream } = build();
    commitFile(repo, 'own.txt', 'own\n');
    upstream('t.test.ts', 'pulled\n');
    pull(repo);
    runLw(repo, ['keep-base', '--reason', 'pull approved', '--pulled']);
    expect(brief(repo).pulledLocks).toEqual(['t.test.ts']);
  });

  it('a base move does not list a locked test edited in a local-only commit', () => {
    const { repo, upstream } = build();
    commitFile(repo, 't.test.ts', 'weakened\n');
    upstream('other.txt', 'pulled\n');
    pull(repo);
    expect(runLw(repo, ['start', TASK, '--force', '--base', 'HEAD']).code).toBe(0);
    expect(brief(repo)).not.toHaveProperty('pulledLocks');
    expect(locks(repo).changed).toEqual(['t.test.ts']);
  });

  it('a base move lists a locked test the pulled commits changed, next to a local-only commit', () => {
    const { repo, upstream } = build();
    commitFile(repo, 'own.txt', 'own\n');
    upstream('t.test.ts', 'pulled\n');
    pull(repo);
    runLw(repo, ['start', TASK, '--force', '--base', 'HEAD']);
    expect(brief(repo).pulledLocks).toEqual(['t.test.ts']);
  });
});
