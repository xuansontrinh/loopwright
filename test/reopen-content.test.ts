import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');
const doc = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const REOPEN_CMD = /lw\.mjs" reopen/;

describe('reopen in content', () => {
  it('reviewer prompt lists relockedAfterReopen in the check-locks output and treats it as information', () => {
    const reviewer = read('prompts/reviewer.md');
    expect(reviewer).toContain('relockedAfterReopen');
    const lines = reviewer.split('\n').filter((l) => l.includes('relockedAfterReopen'));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l) => /information/i.test(l))).toBe(true);
    // the plain re-lock rule stays
    expect(reviewer).toContain('lockedAfterBuild');
  });

  it.each(['flow', 'build', 'review'])('loopwright-%s offers reopen through lw.mjs', (name) => {
    const body = read(`skills/loopwright-${name}/SKILL.md`);
    expect(body).toMatch(REOPEN_CMD);
  });

  it('build skill offers reopen at the deviation gate', () => {
    const body = read('skills/loopwright-build/SKILL.md');
    const line = body.split('\n').find((l) => l.includes('Deviations') && REOPEN_CMD.test(l));
    expect(line).toBeDefined();
  });

  it('review skill offers reopen for undecided findings', () => {
    const body = read('skills/loopwright-review/SKILL.md');
    const undecided = body.split('\n').filter((l) => /undecided/i.test(l) && REOPEN_CMD.test(l));
    expect(undecided.length).toBeGreaterThan(0);
  });

  it('flow skill lists reopen among the human gates or user-driven jumps', () => {
    const body = read('skills/loopwright-flow/SKILL.md');
    expect(body).toMatch(REOPEN_CMD);
    expect(body).toMatch(/plan\|test|plan or test/);
  });

  it('done skill lists locked tests changed after a reopen, with their reasons', () => {
    const body = read('skills/loopwright-done/SKILL.md');
    expect(body).toContain('reopen');
    expect(body).toContain('relockedAfterReopen');
    expect(body).toMatch(/reason/i);
  });

  it('enforcement doc documents reopen and relockedAfterReopen', () => {
    const body = doc('docs/enforcement.md');
    expect(body).toContain('lw.mjs reopen');
    expect(body).toContain('relockedAfterReopen');
    expect(body).toContain('lockedAfterBuild');
  });
});
