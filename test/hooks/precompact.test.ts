import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hookSpecs } from '../../src/install/hook-wiring.js';
import { isolatedEnv, makeBareRepo, makeRepo, runLw } from './helpers.js';

const HOOK = resolve(__dirname, '../../content/hooks/precompact-instructions.mjs');
const TASK = 'tasks/t.md';

function activeTask(stage: string): string {
  const repo = makeRepo();
  writeFileSync(join(repo, '.loopwright', TASK), '# T\n\nstatus: active\nstage: plan\n\n## Goal\n\nShip it.\n');
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  if (stage !== 'test') runLw(repo, ['stage', stage]);
  return repo;
}

function precompact(cwd: string, input?: string, env?: Record<string, string>) {
  const r = spawnSync('node', [HOOK, '--tool', 'claude'], {
    cwd,
    input: input ?? JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto', cwd }),
    encoding: 'utf8',
    env: isolatedEnv(env),
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const instructions = (taskLine: string, wait?: string) =>
  [
    taskLine,
    ...(wait ? [`Waiting on the user: ${wait}`] : []),
    'Keep in the summary, word for word where it is a quote:',
    '- the task file path and the stage;',
    '- any question the user has not answered yet, with its options;',
    '- unresolved review findings, verbatim;',
    '- the implementer report, if a second review pass is still due;',
    '- any user decision that is not yet written in the task file.',
    'After compaction, re-read the task file before continuing.',
  ].join('\n');

describe('compaction instructions hook', () => {
  it('prints the exact instructions for an active task', () => {
    const repo = activeTask('build');
    const r = precompact(repo);
    expect(r.code).toBe(0);
    expect(r.stdout.trimEnd()).toBe(instructions('loopwright task in progress: tasks/t.md (stage: build).'));
  });

  it('names the stage the task is in', () => {
    const repo = activeTask('review');
    expect(precompact(repo).stdout).toContain('loopwright task in progress: tasks/t.md (stage: review).');
  });

  it('adds the pending wait after the first line', () => {
    const repo = activeTask('build');
    runLw(repo, ['await-user', 'deviations in build']);
    const r = precompact(repo);
    expect(r.code).toBe(0);
    expect(r.stdout.trimEnd()).toBe(
      instructions('loopwright task in progress: tasks/t.md (stage: build).', 'deviations in build'),
    );
    expect(r.stdout.split('\n')[1]).toBe('Waiting on the user: deviations in build');
  });

  it('drops the wait line once the user has answered', () => {
    const repo = activeTask('build');
    runLw(repo, ['await-user', 'deviations in build']);
    runLw(repo, ['resume']);
    expect(precompact(repo).stdout).not.toContain('Waiting on the user');
  });

  it('prints nothing and exits 0 with no .loopwright folder', () => {
    const r = precompact(makeBareRepo());
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('prints nothing and exits 0 with no active task', () => {
    const r = precompact(makeRepo());
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('prints nothing and exits 0 once the task is done', () => {
    const repo = activeTask('build');
    runLw(repo, ['done']);
    const r = precompact(repo);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('prints nothing and exits 0 with stdin that is not JSON', () => {
    const repo = activeTask('build');
    const r = precompact(repo, 'this is not json');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('prints nothing and exits 0 with LOOPWRIGHT_HOOKS=off', () => {
    const repo = activeTask('build');
    const r = precompact(repo, undefined, { LOOPWRIGHT_HOOKS: 'off' });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });
});

describe('compaction instructions hook wiring', () => {
  it('wires PreCompact for Claude without a matcher', () => {
    // https://code.claude.com/docs/en/hooks.md (PreCompact): no matcher means manual and automatic compaction both run it
    expect(hookSpecs('claude')).toContainEqual({ event: 'PreCompact', script: 'precompact-instructions.mjs' });
  });

  it('does not wire PreCompact for codex or junie', () => {
    expect(hookSpecs('codex').some((s) => s.event === 'PreCompact')).toBe(false);
    expect(hookSpecs('junie').some((s) => s.event === 'PreCompact')).toBe(false);
  });
});
