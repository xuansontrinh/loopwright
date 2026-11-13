import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, isolatedEnv, loadFixture, makeRepo, runLw } from './helpers.js';

const HOOKS = resolve(__dirname, '../../content/hooks');
const FIX = resolve(__dirname, '../fixtures/hooks');
const TASK = 'tasks/2026-11-13-x.md';
const TOOLS = ['claude', 'codex', 'junie'] as const;

/** Main checkout with no task, plus a linked worktree in build with test/t.test.ts locked. */
function setup(): { repo: string; wt: string } {
  const repo = makeRepo();
  const wt = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-wt-'))), 'wt');
  git(repo, ['worktree', 'add', '-q', '-b', 'feat', wt]);
  expect(runLw(wt, ['start', TASK]).code).toBe(0);
  expect(runLw(wt, ['stage', 'test']).code).toBe(0);
  mkdirSync(join(wt, 'test'));
  writeFileSync(join(wt, 'test/t.test.ts'), 'x');
  expect(runLw(wt, ['lock', 'test/t.test.ts']).code).toBe(0);
  expect(runLw(wt, ['stage', 'build']).code).toBe(0);
  return { repo, wt };
}

/** Payload for the session in `repo` editing `target` (an absolute path). */
function payload(tool: string, repo: string, target: string): string {
  const p = loadFixture(join(FIX, `${tool}-pretooluse.json`), repo);
  if (tool === 'claude') p.tool_input.file_path = target;
  else if (tool === 'codex')
    p.tool_input.command = `*** Begin Patch\n*** Update File: ${target}\n@@\n-a\n+b\n*** End Patch\n`;
  else p.tool_input.patch = `*** Begin Patch\n*** Update File: ${target}\n@@\n-x\n+y\n*** End Patch`;
  return JSON.stringify(p);
}

function runGuard(tool: string, input: string, sessionDir: string) {
  // Junie runs hooks from a folder outside the repo and names the repo in project_path.
  const cwd = tool === 'junie' ? realpathSync(mkdtempSync(join(tmpdir(), 'lw-junie-home-'))) : sessionDir;
  const r = spawnSync('node', [join(HOOKS, 'guard-locked-tests.mjs'), '--tool', tool], {
    cwd,
    input,
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  return { code: r.status, stderr: r.stderr };
}

describe.each(TOOLS)('guard-locked-tests across worktrees (%s)', (tool) => {
  it('denies an edit by absolute path to a test locked in another worktree', () => {
    const { repo, wt } = setup();
    const r = runGuard(tool, payload(tool, repo, join(wt, 'test/t.test.ts')), repo);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('locked acceptance test');
  });

  it('allows an edit to an unlocked file in the other worktree', () => {
    const { repo, wt } = setup();
    const r = runGuard(tool, payload(tool, repo, join(wt, 'src/other.ts')), repo);
    expect(r.code).toBe(0);
  });

  it('allows a same-named file in the main checkout, which locks nothing', () => {
    const { repo } = setup();
    const r = runGuard(tool, payload(tool, repo, join(repo, 'test/t.test.ts')), repo);
    expect(r.code).toBe(0);
  });
});
