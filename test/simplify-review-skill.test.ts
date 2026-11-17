import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const skill = (name: string) => readFileSync(join(contentRoot(), `skills/loopwright-${name}/SKILL.md`), 'utf8');
const section = (text: string, heading: string) => {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start < 0) return '';
  const rest = text.slice(start + 1);
  return rest.slice(0, rest.indexOf('\n## ', 1) < 0 ? undefined : rest.indexOf('\n## ', 1));
};
const numbered = (text: string, n: number) => text.split('\n').find((l) => l.startsWith(`${n}. `)) ?? '';

describe('review skill Simplify section', () => {
  const review = skill('review');
  const simplify = section(review, 'Simplify');

  it('sits between Setup and Passes', () => {
    const at = (h: string) => review.indexOf(`\n## ${h}\n`);
    expect(at('Setup')).toBeGreaterThanOrEqual(0);
    expect(at('Simplify')).toBeGreaterThan(at('Setup'));
    expect(at('Passes')).toBeGreaterThan(at('Simplify'));
  });

  it('is skipped when simplify is false, for small-tier features, outside round 1 of the final scope, and after a logged Simplify', () => {
    expect(simplify).toMatch(/simplify`[^\n]{0,20}false/i);
    expect(simplify).toMatch(/small[- ](tier )?feature/i);
    expect(simplify).toMatch(/round 1/);
    expect(simplify).toMatch(
      /- Simplify:[^\n]*(after|follows)[^\n]*- Scope change:|- Scope change:[^\n]*(before|precedes)[^\n]*- Simplify:/,
    );
  });

  it('is led into by Build and by review Setup step 8', () => {
    const buildSteps = section(skill('build'), 'Steps')
      .split('\n')
      .filter((l) => /^\d+\. /.test(l));
    expect(buildSteps.at(-1)).toMatch(/simplif/i);
    expect(numbered(section(review, 'Setup'), 8)).toMatch(/simplif/i);
    expect(numbered(section(review, 'Setup'), 8)).not.toContain('step 9 and the Passes');
  });
});

describe('review skill Simplify: propose and ask', () => {
  const simplify = section(skill('review'), 'Simplify');

  it('spawns the reviewer with only the task file, base commit and the simplifier procedure', () => {
    expect(simplify).toContain('loopwright-reviewer');
    expect(simplify).toMatch(
      /only[\s\S]{0,200}task file[\s\S]{0,200}base commit[\s\S]{0,200}Follow `\{\{LW_HOME\}\}\/prompts\/simplifier\.md`/,
    );
  });

  it('passes the effort from brief and the whole-branch wording on large tasks', () => {
    expect(simplify).toMatch(/effort[^\n]*brief/i);
    expect(simplify).toContain('Scope: whole-branch review of all slices');
  });

  it('retries invalid JSON once, then logs a skip and lets Review continue', () => {
    expect(simplify).toMatch(/invalid[\s\S]{0,200}(once|one retry)/i);
    expect(simplify).toContain('- Simplify: skipped — invalid output');
  });

  it('logs nothing to cut and asks no question when both lists are empty', () => {
    expect(simplify).toMatch(/both[^\n]*empty/i);
    expect(simplify).toContain('- Simplify: nothing to cut');
    expect(simplify).toMatch(/no question/i);
  });

  it('waits for the user with await-user, asks once, then resumes', () => {
    const at = (s: string) => simplify.indexOf(s);
    expect(at('await-user')).toBeGreaterThanOrEqual(0);
    expect(at('resume')).toBeGreaterThan(at('await-user'));
    expect(simplify).toMatch(/one prompt/i);
  });

  it('asks the obvious cuts as one apply-all or skip-all question', () => {
    expect(simplify).toMatch(/apply[- ]all/i);
    expect(simplify).toMatch(/skip[- ]all/i);
  });

  it('asks one trade-off cut as apply or skip and 2 to 8 as multi-select questions of up to 4 options', () => {
    expect(simplify).toMatch(/one trade-?off cut[^\n]*apply[^\n]*skip/i);
    expect(simplify).toMatch(/2[–-]8/);
    expect(simplify).toMatch(/multi-?select/i);
    expect(simplify).toMatch(/up to 4 options/i);
  });

  it('uses AskUserQuestion on Claude and numbered text on Codex and Junie', () => {
    expect(simplify).toContain('AskUserQuestion');
    expect(simplify).toMatch(/Codex and Junie[^\n]*numbered/i);
  });
});

describe('review skill Simplify: record and apply', () => {
  const simplify = section(skill('review'), 'Simplify');

  it('records approved trade-off cuts as asked decisions and the declined ones on one line', () => {
    expect(simplify).toContain('D<n> [asked]');
    expect(simplify).toMatch(/declined[^\n]*one (decision )?line/i);
  });

  it('writes the Simplify log line before applying anything', () => {
    const line = simplify.split('\n').find((l) => l.includes('- Simplify:') && /before/i.test(l));
    expect(line).toMatch(/before[^\n]*appl/i);
  });

  it('sends locked-test cuts through the tester, re-lock and accept-locks with the decision as reason', () => {
    const at = (s: string) => simplify.indexOf(s);
    expect(simplify).toContain('loopwright-tester');
    expect(at('stage test')).toBeGreaterThanOrEqual(0);
    expect(at('accept-locks')).toBeGreaterThan(at('stage test'));
    expect(simplify).toMatch(/accept-locks --reason/);
    expect(simplify).toMatch(/re-?lock/i);
  });

  it('sets stage build before the implementer applies the approved code cuts verbatim', () => {
    expect(simplify).toContain('loopwright-implementer');
    expect(simplify.lastIndexOf('stage build')).toBeGreaterThan(simplify.indexOf('accept-locks'));
    expect(simplify).toMatch(/approved[^\n]*verbatim/i);
  });

  it('handles Deviations as Build step 4 does', () => {
    expect(simplify).toMatch(/Deviations[^\n]*Build step 4/i);
  });

  it('gives the second pass both implementer reports on two-pass', () => {
    expect(simplify).toMatch(/two-pass: on[^\n]*both[^\n]*report/i);
  });
});
