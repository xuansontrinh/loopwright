import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isolatedEnv, makeRepo, runLw } from './helpers.js';

const HOOK = resolve(__dirname, '../../content/hooks/plain-questions.mjs');
const TASK = 'tasks/t.md';

const TASK_FILE = `# Plain words

kind: feature
status: active
stage: plan

## Goal

Mentions AC9 and D9 in prose only.

## Acceptance criteria

- AC1 first criterion
`;

function activeRepo(): string {
  const repo = makeRepo();
  writeFileSync(join(repo, '.loopwright', TASK), TASK_FILE);
  expect(runLw(repo, ['start', TASK]).code).toBe(0);
  return repo;
}

function ask(repo: string, question: string) {
  const input = JSON.stringify({
    cwd: repo,
    tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question, header: 'Check', multiSelect: false, options: [] }] },
  });
  const r = spawnSync('node', [HOOK, '--tool', 'claude'], { cwd: repo, input, encoding: 'utf8', env: isolatedEnv() });
  return { code: r.status, stderr: r.stderr };
}

describe('question check: edges', () => {
  it.each([
    'Should the Stop Gate stay on?',
    'The fix-round cap is reached. Raise it?',
    'The stop-gate blocked the turn. Continue?',
    'Is this acceptance criterion right?',
    'Is the relock fine?',
    'Is the two pass review worth it?',
    'Should the stop gates stay on?',
    'Were the tests relocked after the change?',
    'Should the fix rounds be capped?',
  ])('denies the phrase in any spelling: %s', (question) => {
    expect(ask(activeRepo(), question).code).toBe(2);
  });

  it.each([
    'Should I fix rounding in the invoice totals before tax?',
    'Process the import in two passes or one?',
    'Should the sign-up form show two password fields?',
    'Should the proxy stop gateway traffic during the migration?',
  ])('allows an everyday word that only starts like a phrase: %s', (question) => {
    expect(ask(activeRepo(), question).code).toBe(0);
  });

  it('allows an id the task file only mentions in prose', () => {
    expect(ask(activeRepo(), 'Is AC9 still what you want, or D9?').code).toBe(0);
  });

  it('allows an id that only extends a defined one', () => {
    expect(ask(activeRepo(), 'Is AC10 still what you want?').code).toBe(0);
  });

  it('denies a defined id and a phrase in one question, quoting both', () => {
    const r = ask(activeRepo(), 'Keep AC1 after the re-lock?');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('AC1');
    expect(r.stderr).toContain('re-lock');
  });

  it('counts two denials again after a third attempt went through', () => {
    const repo = activeRepo();
    const bad = 'Is AC1 still what you want?';
    expect([bad, bad, bad, bad, bad, bad].map((q) => ask(repo, q).code)).toEqual([2, 2, 0, 2, 2, 0]);
  });

  it('allows with a warning when the task file is gone', () => {
    const repo = activeRepo();
    rmSync(join(repo, '.loopwright', TASK));
    const r = ask(repo, 'Is AC1 still what you want?');
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/hook error/);
  });
});
