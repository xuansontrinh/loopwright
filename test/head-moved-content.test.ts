import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');

/** The Setup step that mentions headMoved, up to the next numbered step or heading. */
function headMovedStep(skill: string): string {
  const setup = skill.split('\n## ')[1]!;
  const lines = setup.split('\n');
  const start = lines.findIndex((l) => l.includes('headMoved'));
  if (start === -1) return '';
  const end = lines.findIndex((l, i) => i > start && /^\d+\. /.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

describe.each([
  ['build', '## Steps'],
  ['review', '## Passes'],
])('loopwright-%s asks once about a moved branch', (name, nextSection) => {
  const skill = read(`skills/loopwright-${name}/SKILL.md`);
  const step = headMovedStep(skill);

  it('reads headMoved from brief in Setup, before the first subagent runs', () => {
    expect(step).not.toBe('');
    expect(skill.indexOf('headMoved')).toBeLessThan(skill.indexOf(nextSection));
  });

  it('waits with await-user, lists the commits, asks one question and resumes', () => {
    expect(step).toContain('await-user');
    expect(step).toMatch(/list[^.]{0,40}commits|commits[^.]{0,40}list/i);
    expect(step).toMatch(/one question/i);
    expect(step).toContain('resume');
    expect(step.indexOf('await-user')).toBeLessThan(step.indexOf('resume'));
  });

  it('offers pulled commits (left out of the review) or this task own commits (kept in)', () => {
    expect(step).toMatch(/pulled[^.]{0,80}leave[^.]{0,30}out/i);
    expect(step).toMatch(/own commits[^.]{0,80}keep[^.]{0,30}in/i);
  });

  it('records the answer as an asked decision', () => {
    expect(step).toContain('D<n> [asked]');
  });

  it('pulled moves the base with start --force --base HEAD and sets the stage back', () => {
    expect(step).toMatch(/lw\.mjs" start <task> --force --base HEAD/);
    expect(step).toMatch(/lw\.mjs" stage /);
  });

  it('pulled accepts the restart with the decision as the reason and updates the header base commit', () => {
    expect(step).toMatch(/accept-locks --restart/);
    expect(step).toContain('--reason');
    expect(step).toContain('base commit');
  });

  it('own commits, or a branch holding both kinds, runs keep-base', () => {
    expect(step).toMatch(/lw\.mjs" keep-base --reason/);
    expect(step).toMatch(/both kinds|holds both/i);
  });

  it('a branch holding both kinds tells the user the pulled commits stay in the review', () => {
    expect(step).toMatch(/both[\s\S]{0,300}(tell|told)[\s\S]{0,120}pulled commits[\s\S]{0,60}stay[\s\S]{0,40}review/i);
  });
});
