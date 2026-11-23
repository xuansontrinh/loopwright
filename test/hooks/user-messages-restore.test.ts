import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isolatedEnv, makeRepo, runLw } from './helpers.js';

const REINJECT = resolve(__dirname, '../../content/hooks/reinject-context.mjs');
const PRECOMPACT = resolve(__dirname, '../../content/hooks/precompact-instructions.mjs');
const TASK = 'tasks/t.md';
const RULES_FILE = /prompts[\\/]user-messages\.md/;

function activeTask(decisions = 2): string {
  const repo = makeRepo();
  const lines = Array.from({ length: decisions }, (_, i) => `- D${i + 1}: decision number ${i + 1}`);
  writeFileSync(
    join(repo, '.loopwright', TASK),
    `# T\n\nstatus: active\nstage: plan\n\n## Goal\n\nShip it.\n\n## Decisions\n\n${lines.join('\n')}\n`,
  );
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  runLw(repo, ['stage', 'build']);
  return repo;
}

function reinject(repo: string, tool: 'claude' | 'codex'): string {
  const r = spawnSync('node', [REINJECT, '--tool', tool], {
    cwd: repo,
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', cwd: repo }),
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  expect(r.status).toBe(0);
  return tool === 'codex' ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : r.stdout;
}

function precompact(repo: string): string {
  const r = spawnSync('node', [PRECOMPACT, '--tool', 'claude'], {
    cwd: repo,
    input: JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto', cwd: repo }),
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  expect(r.status).toBe(0);
  return r.stdout;
}

const rulesLine = (text: string) => text.split('\n').find((l) => RULES_FILE.test(l));

describe.each(['claude', 'codex'] as const)('context restore after compaction (%s)', (tool) => {
  it('points back to the user message rules', () => {
    expect(rulesLine(reinject(activeTask(), tool))).toBeDefined();
  });

  it('points back to the rules while waiting on the user', () => {
    const repo = activeTask();
    runLw(repo, ['await-user', 'deviations in build']);
    const text = reinject(repo, tool);
    expect(text).toContain('Waiting on the user: deviations in build');
    expect(rulesLine(text)).toBeDefined();
  });

  it('points back to the rules when the task file is gone', () => {
    const repo = activeTask();
    rmSync(join(repo, '.loopwright', TASK));
    const text = reinject(repo, tool);
    expect(text).toContain('Stage: build');
    expect(rulesLine(text)).toBeDefined();
  });

  it('keeps the rules line, the next step and the 40 line cap with many decisions', () => {
    const text = reinject(activeTask(80), tool);
    expect(rulesLine(text)).toBeDefined();
    expect(text).toContain('Continue /loopwright-build; locked tests must not be edited.');
    expect(text.trim().split('\n').length).toBeLessThanOrEqual(40);
  });
});

describe('compaction keep-list', () => {
  it('names the user message rules after the keep header', () => {
    const lines = precompact(activeTask()).split('\n');
    const keep = lines.findIndex((l) => l.startsWith('Keep in the summary'));
    const rules = lines.findIndex((l) => RULES_FILE.test(l));
    expect(keep).toBeGreaterThanOrEqual(0);
    expect(rules).toBeGreaterThan(keep);
  });

  it('names the rules while waiting on the user', () => {
    const repo = activeTask();
    runLw(repo, ['await-user', 'deviations in build']);
    const text = precompact(repo);
    expect(text).toContain('Waiting on the user: deviations in build');
    expect(rulesLine(text)).toBeDefined();
  });
});
