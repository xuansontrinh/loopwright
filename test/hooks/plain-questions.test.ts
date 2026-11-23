import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isolatedEnv, makeBareRepo, makeRepo, runLw } from './helpers.js';

const HOOK = resolve(__dirname, '../../content/hooks/plain-questions.mjs');
const TASK = 'tasks/t.md';
const RULES_FILE = /prompts[\\/]user-messages\.md/;
const SILENT = { code: 0, stdout: '', stderr: '' };

const TASK_FILE = `# Plain words

kind: feature
status: active
stage: plan

## Goal

Ship it.

## Decisions

- D1 [asked] first choice
- D2 [asked] second choice

## Assumptions

- A1 [confirmed] the runner exists — package.json

## Acceptance criteria

- AC1 first criterion
- AC2 second criterion
- AC3 third criterion
- AC4 fourth criterion

## Slices

- S1 [passed] first slice — AC1
- S2 [todo] second slice — AC2

## Review log

- R1 S1: fail — 1 blocking, 1 undecided
  - U1 src/a.ts:3: fix — the user's reason
`;

interface Question {
  question: string;
  header: string;
  multiSelect: boolean;
  options: { label: string; description: string }[];
}

const plain: Question = {
  question: 'Which way should the new check report a problem?',
  header: 'Report',
  multiSelect: false,
  options: [
    { label: 'Stop with a message', description: 'The check ends the run and prints what went wrong.' },
    { label: 'Warn and go on', description: 'The check prints a warning and the run continues.' },
  ],
};

const withQuestion = (question: string): Question => ({ ...plain, question });

function activeRepo(): string {
  const repo = makeRepo();
  writeFileSync(join(repo, '.loopwright', TASK), TASK_FILE);
  expect(runLw(repo, ['start', TASK]).code).toBe(0);
  return repo;
}

function payload(repo: string, toolName: string, toolInput: unknown): string {
  return JSON.stringify({
    session_id: 'sess-1',
    cwd: repo,
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'toolu_1',
  });
}

function check(cwd: string, input: string, env?: Record<string, string>) {
  const r = spawnSync('node', [HOOK, '--tool', 'claude'], { cwd, input, encoding: 'utf8', env: isolatedEnv(env) });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const ask = (repo: string, ...questions: Question[]) => check(repo, payload(repo, 'AskUserQuestion', { questions }));

function expectDenied(r: { code: number | null; stderr: string }, offending: string): void {
  expect(r.code).toBe(2);
  expect(r.stderr).toContain(offending);
  expect(r.stderr).toMatch(RULES_FILE);
}

describe('question check: bare loopwright labels', () => {
  const inField: Record<string, [string, Question]> = {
    'the question text': ['AC1', withQuestion('Should the AC1 checks stay as they are?')],
    'the header': ['AC2', { ...plain, header: 'AC2 scope' }],
    'an option label': [
      'D1',
      { ...plain, options: [{ ...plain.options[0]!, label: 'Keep D1 as decided' }, plain.options[1]!] },
    ],
    'an option description': [
      'D2',
      { ...plain, options: [plain.options[0]!, { ...plain.options[1]!, description: 'Keeps D2 and moves on.' }] },
    ],
  };

  it.each(Object.entries(inField))('a task id in %s is denied, quoting it and naming the rules file', (_, [id, q]) => {
    expectDenied(ask(activeRepo(), q), id);
  });

  it.each(['AC3', 'D2', 'A1', 'S2', 'R1', 'U1'])('the defined task id %s is denied', (id) => {
    expectDenied(ask(activeRepo(), withQuestion(`Is ${id} still what you want?`)), id);
  });

  it.each(['stop gate', 're-lock', 'fix round', 'two-pass', 'acceptance criteria'])(
    'the loopwright-only phrase "%s" is denied',
    (phrase) => {
      expectDenied(ask(activeRepo(), withQuestion(`Do you want to change the ${phrase} for this task?`)), phrase);
    },
  );

  it('a bare id after a bracketed one is still denied', () => {
    expectDenied(ask(activeRepo(), withQuestion('Keep the old checks (AC3) and also AC4?')), 'AC4');
  });

  it('a bad question anywhere in a multi-question payload is denied', () => {
    const bad: Question = {
      ...plain,
      options: [plain.options[0]!, { ...plain.options[1]!, description: 'Moves on to the next stage, S2.' }],
    };
    expectDenied(ask(activeRepo(), plain, bad), 'S2');
  });

  it.each(['plan', 'test', 'build', 'review'])('a bad question is denied while the task is in %s', (stage) => {
    const repo = activeRepo();
    if (stage !== 'plan') expect(runLw(repo, ['stage', stage]).code).toBe(0);
    expectDenied(ask(repo, withQuestion('Is AC3 still what you want?')), 'AC3');
  });

  it('a bad question is denied while the agent waits for the user', () => {
    const repo = activeRepo();
    expect(runLw(repo, ['await-user', 'scope question']).code).toBe(0);
    expectDenied(ask(repo, withQuestion('Is AC3 still what you want?')), 'AC3');
  });

  it.each([
    'Should the checks written for the goal (AC3) stay as they are?',
    'Should the checks written for the goal [AC3] stay as they are?',
    'Should the checks written for the goal `AC3` stay as they are?',
    'Should the check that blocks finishing early (the stop gate) stay as it is?',
    'Should the check that blocks finishing early (stop gate, fix round) stay as it is?',
    'Should the tests be frozen again after a change [re-lock]?',
    'Should the `two-pass` setting stay on?',
  ])('a label in brackets after a plain description is allowed: %s', (text) => {
    expect(ask(activeRepo(), withQuestion(text)).code).toBe(0);
  });

  it('a label in brackets in an option label and description is allowed', () => {
    const q: Question = {
      ...plain,
      options: [
        { label: 'Keep the decision (D2)', description: 'Keeps the earlier choice (D2) and moves on.' },
        plain.options[1]!,
      ],
    };
    expect(ask(activeRepo(), q).code).toBe(0);
  });

  it('the same question is denied with the label bare and allowed with it in brackets', () => {
    const repo = activeRepo();
    expect(ask(repo, withQuestion('Should the tests for the first goal stay frozen, AC3?')).code).toBe(2);
    expect(ask(repo, withQuestion('Should the tests for the first goal stay frozen (AC3)?')).code).toBe(0);
  });

  it('an id the task file does not define is allowed', () => {
    expect(ask(activeRepo(), withQuestion('Should uploads go to the Amazon S3 bucket?')).code).toBe(0);
  });

  it('a plain question is allowed', () => {
    expect(ask(activeRepo(), plain, withQuestion('Which name should the new check have?'))).toEqual(SILENT);
  });
});

describe('question check: allowing silently', () => {
  const bad = withQuestion('Is AC3 still what you want?');

  it('allows with no active task', () => {
    const repo = makeRepo();
    expect(ask(repo, bad)).toEqual(SILENT);
  });

  it('allows once the task is done', () => {
    const repo = activeRepo();
    expect(runLw(repo, ['done']).code).toBe(0);
    expect(ask(repo, bad)).toEqual(SILENT);
  });

  it('allows in a repo without a .loopwright folder', () => {
    expect(ask(makeBareRepo(), bad)).toEqual(SILENT);
  });

  it('allows under LOOPWRIGHT_HOOKS=off', () => {
    const repo = activeRepo();
    expect(check(repo, payload(repo, 'AskUserQuestion', { questions: [bad] }), { LOOPWRIGHT_HOOKS: 'off' })).toEqual(
      SILENT,
    );
  });

  it.each([
    ['text that is not JSON', '{not json'],
    ['empty input', ''],
  ])('allows on unreadable input: %s', (_, input) => {
    expect(check(activeRepo(), input)).toEqual(SILENT);
  });

  it.each(['Write', 'Edit', 'Bash'])('allows a payload for the %s tool, whatever its text says', (tool) => {
    const repo = activeRepo();
    const text = 'AC3 stop gate re-lock';
    const input = { file_path: join(repo, 'x.md'), content: text, new_string: text, command: text, questions: [bad] };
    expect(check(repo, payload(repo, tool, input))).toEqual(SILENT);
  });

  it('lets the third attempt through after two denials in a row', () => {
    const repo = activeRepo();
    expect(ask(repo, bad).code).toBe(2);
    expect(ask(repo, bad).code).toBe(2);
    expect(ask(repo, bad)).toEqual(SILENT);
  });

  it('starts counting again after a plain question in between', () => {
    const repo = activeRepo();
    expect(ask(repo, bad).code).toBe(2);
    expect(ask(repo, plain).code).toBe(0);
    expect(ask(repo, bad).code).toBe(2);
    expect(ask(repo, bad).code).toBe(2);
    expect(ask(repo, bad)).toEqual(SILENT);
  });
});
