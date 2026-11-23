import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listContent } from '../src/core/content.js';

const root = join(__dirname, '..');
const doc = (rel: string) => readFileSync(join(root, rel), 'utf8');
const section = (text: string, heading: RegExp) => {
  const parts = text.split(/^(?=#{2,3} )/m);
  const at = parts.findIndex((p) => heading.test(p.split('\n')[0]!));
  return at < 0 ? '' : parts[at]!;
};
const QUESTION_CHECK = /question check|plain[- ]words check/i;
const QUESTION_CHECK_CLAUDE_ONLY = /question check[^.|;)]{0,40}Claude Code|Claude Code[^.|;)]{0,40}question check/i;
const RULES_FILE = 'prompts/user-messages.md';

describe('README', () => {
  const support = section(doc('README.md'), /^## Support/);
  const rows = support.split('\n').filter((l) => l.startsWith('|'));

  it('the support table has a row for the plain-words message rules', () => {
    expect(rows.some((r) => /plain[- ]words/i.test(r) && /rules/i.test(r))).toBe(true);
  });

  it('the hook enforcement row lists the question check as Claude Code only', () => {
    const row = rows.find((r) => /^\|\s*Hook enforcement/.test(r));
    expect(row).toMatch(QUESTION_CHECK);
    expect(row).toMatch(QUESTION_CHECK_CLAUDE_ONLY);
  });
});

describe('enforcement doc', () => {
  const enforcement = doc('docs/enforcement.md');

  it('counts five hooks on Claude Code and three elsewhere', () => {
    expect(enforcement).toMatch(/^Five hooks\b[^\n]*Claude Code[^\n]*three elsewhere/m);
  });

  it('lists the question check as a PreToolUse hook on AskUserQuestion, Claude Code only', () => {
    const line = enforcement.split('\n').find((l) => /^- \*\*/.test(l) && QUESTION_CHECK.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/PreToolUse/);
    expect(line).toMatch(/AskUserQuestion/);
    expect(line).toMatch(/Claude Code only/i);
  });

  it('has a section on plain words that names the rules file and what the check does', () => {
    const body = section(enforcement, /^## .*(plain[- ]words|messages to you)/i);
    expect(body).not.toBe('');
    expect(body).toContain(RULES_FILE);
    expect(body).toMatch(/task id/i);
    expect(body).toMatch(/(?:after|at most) (?:2|two)\b|twice/i);
    expect(body).toMatch(/Codex/);
    expect(body).toMatch(/Junie/);
  });
});

describe('workflow doc', () => {
  const workflow = doc('docs/workflow.md');

  it('names the rules file', () => {
    expect(workflow).toContain(RULES_FILE);
  });

  it('lists the question check among what the hooks do, as Claude Code only', () => {
    const hooks = section(workflow, /^## What the hooks do along the way/);
    const line = hooks.split('\n').find((l) => /^- \*\*/.test(l) && QUESTION_CHECK.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/Claude Code only/i);
  });
});

describe('installation doc', () => {
  const written = doc('docs/installation.md')
    .split('\n')
    .find((l) => l.includes('.agents/loopwright/') && l.includes('hooks/'));

  it.each(listContent('prompts'))('the repo install list names prompts/%s', (file) => {
    expect(written).toContain(`prompts/${file}`);
  });
});

describe('dogfood checklist', () => {
  const checks = doc('docs/dogfood-checklist.md')
    .split('\n')
    .filter((l) => l.startsWith('- [ ]'));

  it('has a line for plain words in every message to the user', () => {
    expect(checks.some((l) => /plain[- ]words/i.test(l))).toBe(true);
  });

  it('has a line for a question with a bare label being sent back', () => {
    expect(checks.some((l) => QUESTION_CHECK.test(l))).toBe(true);
  });
});
