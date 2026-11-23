import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';
import { createTempGitRepo, runCli } from './helpers.js';

const SKILLS = ['flow', 'plan', 'fix', 'park', 'explore', 'test', 'build', 'review', 'done'];
const RULES_REF = '{{LW_HOME}}/prompts/user-messages.md';
const skill = (name: string) => readFileSync(join(contentRoot(), `skills/loopwright-${name}/SKILL.md`), 'utf8');

function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}`);
  if (start < 0) return '';
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next < 0 ? rest : rest.slice(0, next);
}

function block(text: string, first: RegExp): string {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => first.test(l));
  if (at < 0) return '';
  const out = [lines[at]!];
  for (const l of lines.slice(at + 1)) {
    if (!/^\s+\S/.test(l)) break;
    out.push(l);
  }
  return out.join('\n');
}

function expectPlainWordsFollowingRules(text: string): void {
  expect(text).toMatch(/plain words/i);
  expect(text).toMatch(/rules file|user-messages?|writing rules/i);
}

describe.each(SKILLS)('loopwright-%s rules file pointer', (name) => {
  it('tells the agent to read the rules file unless it already read it in this conversation', () => {
    const line = skill(name)
      .split('\n')
      .find((l) => l.includes(RULES_REF));
    expect(line).toBeDefined();
    expect(line).toMatch(/\bread\b/i);
    expect(line).toMatch(/already read[^\n]{0,60}conversation/i);
  });

  it('comes before the first line of Setup that talks to the user', () => {
    const lines = skill(name).split('\n');
    const pointer = lines.findIndex((l) => l.includes(RULES_REF));
    const setup = lines.indexOf('## Setup');
    const firstMessage = lines.findIndex(
      (l, i) => i > setup && i !== pointer && /\b(tell|warn|ask|show|list|say)\b[^\n]{0,30}\buser\b/i.test(l),
    );
    expect(pointer).toBeGreaterThanOrEqual(0);
    expect(firstMessage).toBeGreaterThan(setup);
    expect(pointer).toBeLessThan(firstMessage);
  });
});

describe('Plan shows ids and decisions in plain words', () => {
  const plan = skill('plan');

  it('shows the assumption ledger as a plain numbered list', () => {
    const ledger = section(plan, '3. ');
    expectPlainWordsFollowingRules(ledger);
    expect(ledger).toMatch(/numbered list/i);
  });

  it('keeps the task file line shapes while the ledger is shown in plain words', () => {
    expect(section(plan, '3. ')).toMatch(/line shapes?/i);
  });

  it('shows the decisions as a plain numbered list', () => {
    const line = plan.split('\n').find((l) => /decisions/i.test(l) && /numbered list/i.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/plain/i);
  });

  it('explains the proposal in plain words', () => {
    expectPlainWordsFollowingRules(section(plan, '6. '));
  });

  it('gives the confirmation summary in plain words, not as counts of ids', () => {
    const summary = section(plan, '7. ')
      .split('\n')
      .find((l) => /summary/i.test(l));
    expect(summary).toBeDefined();
    expectPlainWordsFollowingRules(summary!);
    expect(summary).not.toContain('decisions count, ACs');
  });
});

describe('Test shows its results in plain words', () => {
  const steps = section(skill('test'), 'Steps');

  it('tells the user the final report in plain words, not as tests, AC counts and lock paths', () => {
    const report = steps.split('\n').find((l) => l.startsWith('5. '));
    expect(report).toBeDefined();
    expectPlainWordsFollowingRules(report!);
    expect(report).not.toContain('ACs covered');
  });

  it('shows the tester Uncovered and Needs items in plain words', () => {
    const shown = steps.split('\n').filter((l) => /\bshow\b/i.test(l) && /`(Uncovered|Needs)`/.test(l));
    expect(shown.length).toBeGreaterThan(0);
    for (const l of shown) expectPlainWordsFollowingRules(l);
  });
});

describe('Build shows deviations in plain words', () => {
  it('shows each implementer deviation in plain words', () => {
    const shown = section(skill('build'), 'Steps')
      .split('\n')
      .filter((l) => /\bshow\b/i.test(l) && l.includes('`Deviations`'));
    expect(shown.length).toBeGreaterThan(0);
    for (const l of shown) expectPlainWordsFollowingRules(l);
  });
});

describe('Review shows findings and cuts in plain words', () => {
  const review = skill('review');

  it('shows the blocking findings summary in plain words', () => {
    expectPlainWordsFollowingRules(block(section(review, 'Outcome'), /\*\*Blocking\*\* present/));
  });

  it('shows each undecided finding in plain words', () => {
    expectPlainWordsFollowingRules(block(section(review, 'Outcome'), /Only \*\*Undecided\*\*/));
  });

  it('asks about the Simplify cuts in plain words', () => {
    expectPlainWordsFollowingRules(block(section(review, 'Simplify'), /\*\*Ask\.\*\*/));
  });
});

describe('Flow stage update', () => {
  it('is one line in plain words that says what the next stage does for the user', () => {
    const line = skill('flow')
      .split('\n')
      .find((l) => /\bone[- ]line\b/i.test(l));
    expect(line).toBeDefined();
    expectPlainWordsFollowingRules(line!);
    expect(line).toMatch(/for the user/i);
  });
});

describe('init installs the rules file', () => {
  it('repo mode writes the file and points every skill at the installed copy', () => {
    const repo = createTempGitRepo('lw-um-');
    const r = runCli(repo, ['init'], { home: mkdtempSync(join(tmpdir(), 'lw-h-')) });
    expect(r.exitCode, r.stderr).toBe(0);
    const installed = join(repo, '.agents/loopwright/prompts/user-messages.md');
    expect(existsSync(installed)).toBe(true);
    expect(readFileSync(installed, 'utf8')).not.toContain('{{');
    for (const name of SKILLS) {
      const text = readFileSync(join(repo, `.agents/skills/loopwright-${name}/SKILL.md`), 'utf8');
      expect(text, name).toContain('.agents/loopwright/prompts/user-messages.md');
      expect(text, name).not.toContain('{{');
    }
  });

  it('global mode writes the file under the home config and points every skill at it', () => {
    const home = mkdtempSync(join(tmpdir(), 'lw-h-'));
    const r = runCli(createTempGitRepo('lw-um-'), ['init', '--global', '--force'], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    const installed = join(home, '.config/loopwright/prompts/user-messages.md');
    expect(existsSync(installed)).toBe(true);
    expect(readFileSync(installed, 'utf8')).not.toContain('{{');
    const pointer = `${join(home, '.config/loopwright')}/prompts/user-messages.md`;
    for (const name of SKILLS) {
      const text = readFileSync(join(home, `.agents/skills/loopwright-${name}/SKILL.md`), 'utf8');
      expect(text, name).toContain(pointer);
    }
  });
});
