import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');
const doc = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const lines = (text: string, ...needles: (string | RegExp)[]) =>
  text.split('\n').filter((l) => needles.every((n) => (typeof n === 'string' ? l.includes(n) : n.test(l))));
const paragraphs = (text: string, ...needles: (string | RegExp)[]) =>
  text.split(/\n\s*\n/).filter((p) => needles.every((n) => (typeof n === 'string' ? p.includes(n) : n.test(p))));

describe.each(['build', 'review'])('loopwright-%s sends a pulled locked test back to the tester', (name) => {
  const skill = read(`skills/loopwright-${name}/SKILL.md`);
  const step = lines(skill, 'pulledLocks').join('\n');

  it('reads pulledLocks from brief', () => {
    expect(step).not.toBe('');
  });

  it('sends only the listed files to Test before the implementer or reviewer runs', () => {
    expect(step).toMatch(/only[^.]{0,40}files?/i);
    expect(step).toMatch(/before[^.]{0,30}(implementer|reviewer)/i);
  });

  it('uses reopen test once Build has begun and stage test otherwise', () => {
    expect(step).toMatch(/lw\.mjs" reopen test/);
    expect(step).toMatch(/lw\.mjs" stage test/);
    expect(step).toMatch(/Build has begun|begun Build/i);
  });

  it('accepts the re-locks with accept-locks under the pull decision', () => {
    expect(step).toContain('accept-locks');
    expect(step).toContain('--reason');
    expect(step).toMatch(/pull[^.]{0,60}decision|decision[^.]{0,60}pull/i);
  });
});

describe('test skill and tester agent allow the pulled re-lock', () => {
  const test = read('skills/loopwright-test/SKILL.md');
  const tester = read('agents/tester.md');

  it('test skill scopes the stage to the files in pulledLocks', () => {
    expect(lines(test, 'pulledLocks')).not.toEqual([]);
  });

  it('test skill has the tester check each listed file still tests its acceptance criteria, edit only what the pull broke, and re-lock', () => {
    const scope = lines(test, 'pulledLocks').join('\n');
    expect(scope).toMatch(/still tests? its (acceptance criteria|ACs)/i);
    expect(scope).toMatch(/only what the pull broke/i);
    expect(scope).toMatch(/re-lock/i);
  });

  it('test skill re-lock rule names the pulled-locks scope as an exception', () => {
    const rule = lines(test, /^- Lock only in this stage/, /never re-lock/i).join('\n');
    expect(rule).toMatch(/pull/i);
  });

  it('tester agent may edit and re-lock the listed pulled test files and no other locked test', () => {
    const boundary = lines(tester, /pull/i, /re-lock/i).join('\n');
    expect(boundary).not.toBe('');
    expect(boundary).toMatch(/pulledLocks|pulled/i);
    expect(boundary).toMatch(/other locked test|every other locked test|only/i);
  });
});

describe('docs say a pulled locked test goes back to the tester', () => {
  it.each(['docs/enforcement.md', 'docs/workflow.md'])(
    '%s says the changed test goes to the tester and is re-locked',
    (file) => {
      const text = paragraphs(doc(file), /pull/i, /tester/i, /re-lock/i).join('\n');
      expect(text).toMatch(/locked test/i);
      expect(text).toMatch(/approved pull|pull you approved|pull the user approved|pulled/i);
    },
  );

  it('enforcement.md says it is not reported as blocking', () => {
    const text = paragraphs(doc('docs/enforcement.md'), /pull/i, /tester/i, /re-lock/i).join('\n');
    expect(text).toMatch(/not (reported as |raised as |a )?blocking|does not block|never blocks/i);
  });
});
