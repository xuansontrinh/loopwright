import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isolatedEnv, makeRepo, runLw } from './helpers.js';

const HOOK = resolve(__dirname, '../../content/hooks/reinject-context.mjs');
const TASK = 'tasks/2026-11-08-x.md';
const ROOT_CAUSE = 'src/parse.ts:42 - the trailing comma is dropped before the split';

function task(opts: { kind?: string; rootCause?: string[]; decisions?: number }): string {
  const header = opts.kind ? `kind: ${opts.kind}\n` : '';
  const decisions = Array.from({ length: opts.decisions ?? 2 }, (_, i) => `- D${i + 1}: decision number ${i + 1}`);
  const root = opts.rootCause ? `\n## Root cause\n\n${opts.rootCause.join('\n')}\n` : '';
  return `# Title\n\n${header}status: active\n\n## Goal\n\nShip the widget.\n${root}\n## Decisions\n\n${decisions.join('\n')}\n\nOther line.\n`;
}

function setup(content: string, stage = 'build'): string {
  const repo = makeRepo();
  writeFileSync(join(repo, '.loopwright', TASK), content);
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  if (stage !== 'test') runLw(repo, ['stage', stage]);
  return repo;
}

function reinject(repo: string, tool: 'claude' | 'codex' = 'claude'): string {
  const r = spawnSync('node', [HOOK, '--tool', tool], {
    cwd: repo,
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', cwd: repo }),
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  expect(r.status).toBe(0);
  return tool === 'codex' ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : r.stdout;
}

const count = (text: string) => text.trim().split('\n').length;

describe('reinject-context for fix tasks', () => {
  it('restores the fix kind and the root cause line after compaction', () => {
    const repo = setup(task({ kind: 'fix', rootCause: [ROOT_CAUSE] }));
    const text = reinject(repo);
    expect(text).toContain('kind: fix');
    expect(text).toContain(ROOT_CAUSE);
    expect(text).toContain('Ship the widget.');
    expect(text).toContain('Stage: build');
    expect(text).toContain('- D1: decision number 1');
  });

  it('restores them for codex output too', () => {
    const repo = setup(task({ kind: 'fix', rootCause: [ROOT_CAUSE] }));
    const text = reinject(repo, 'codex');
    expect(text).toContain('kind: fix');
    expect(text).toContain(ROOT_CAUSE);
  });

  it('still restores the fix kind when no root cause is written yet', () => {
    const repo = setup(task({ kind: 'fix' }), 'test');
    const text = reinject(repo);
    expect(text).toContain('kind: fix');
    expect(text).toContain('Stage: test');
  });

  it('keeps the fix kind and root cause when waiting on the user', () => {
    const repo = setup(task({ kind: 'fix', rootCause: [ROOT_CAUSE] }));
    runLw(repo, ['await-user', 'sibling gate']);
    const text = reinject(repo);
    expect(text).toContain('kind: fix');
    expect(text).toContain(ROOT_CAUSE);
    expect(text).toContain('Waiting on the user: sibling gate');
  });

  it('stays within 40 lines and keeps kind, root cause and next step with many decisions', () => {
    const repo = setup(task({ kind: 'fix', rootCause: [ROOT_CAUSE], decisions: 80 }));
    const text = reinject(repo);
    expect(count(text)).toBeLessThanOrEqual(40);
    expect(text).toContain('kind: fix');
    expect(text).toContain(ROOT_CAUSE);
    expect(text).toContain('Continue /loopwright-build; locked tests must not be edited.');
  });

  it('stays within 40 lines with a long root cause section', () => {
    const long = [ROOT_CAUSE, ...Array.from({ length: 60 }, (_, i) => `detail line ${i}`)];
    const repo = setup(task({ kind: 'fix', rootCause: long, decisions: 10 }));
    const text = reinject(repo);
    expect(count(text)).toBeLessThanOrEqual(40);
    expect(text).toContain('kind: fix');
    expect(text).toContain(ROOT_CAUSE);
  });
});

describe('reinject-context for feature tasks', () => {
  const expected = [
    `loopwright: active task ${TASK}`,
    'Ship the widget.',
    'Stage: build',
    '- D1: decision number 1',
    '- D2: decision number 2',
    'Continue /loopwright-build; locked tests must not be edited.',
  ].join('\n');

  it('output is unchanged without a kind header', () => {
    const repo = setup(task({}));
    expect(reinject(repo).trim()).toBe(expected);
  });

  it('output is unchanged with kind feature', () => {
    const repo = setup(task({ kind: 'feature' }));
    expect(reinject(repo).trim()).toBe(expected);
  });

  it('does not restore a root cause section for a feature task', () => {
    const repo = setup(task({ kind: 'feature', rootCause: [ROOT_CAUSE] }));
    const text = reinject(repo);
    expect(text).not.toContain(ROOT_CAUSE);
    expect(text).not.toContain('kind:');
  });
});
