import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, isolatedEnv, loadFixture, makeRepo, runLw } from './helpers.js';

const HOOKS = resolve(__dirname, '../../content/hooks');
const FIX = resolve(__dirname, '../fixtures/hooks');

function guard(repo: string, target: string) {
  const p = loadFixture(join(FIX, 'claude-pretooluse.json'), repo);
  p.tool_input.file_path = target;
  const r = spawnSync('node', [join(HOOKS, 'guard-locked-tests.mjs'), '--tool', 'claude'], {
    cwd: repo,
    input: JSON.stringify(p),
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  return { code: r.status, stderr: r.stderr };
}

/** A repo whose task is in build with pkg/t.test.ts locked, where pkg is its own git repo. */
function setup(): string {
  const repo = makeRepo();
  const pkg = join(repo, 'pkg');
  mkdirSync(pkg);
  git(pkg, ['init', '-q', '-b', 'main']);
  writeFileSync(join(pkg, 't.test.ts'), 'x');
  expect(runLw(repo, ['start', 'tasks/x.md']).code).toBe(0);
  expect(runLw(repo, ['stage', 'test']).code).toBe(0);
  expect(runLw(repo, ['lock', 'pkg/t.test.ts']).code).toBe(0);
  expect(runLw(repo, ['stage', 'build']).code).toBe(0);
  return repo;
}

describe('guard-locked-tests in the session worktree', () => {
  it('denies a locked test inside a nested git repo of the session worktree', () => {
    const repo = setup();
    for (const target of ['pkg/t.test.ts', join(repo, 'pkg/t.test.ts')]) {
      const r = guard(repo, target);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('locked acceptance test');
    }
  });

  it('allows an unlocked file in the nested git repo', () => {
    const repo = setup();
    expect(guard(repo, 'pkg/other.ts').code).toBe(0);
  });
});
