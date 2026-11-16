import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');
const doc = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const lines = (text: string, ...needles: (string | RegExp)[]) =>
  text.split('\n').filter((l) => needles.every((n) => (typeof n === 'string' ? l.includes(n) : n.test(l))));

describe('review skill accepts re-locks and restarts', () => {
  const review = read('skills/loopwright-review/SKILL.md');

  it('reads flaggedLocks from brief before the first reviewer is spawned', () => {
    expect(review).toContain('flaggedLocks');
    expect(review.indexOf('flaggedLocks')).toBeLessThan(review.indexOf('**Blind pass.**'));
  });

  it('accepts an item a task-file decision covers with that decision as the reason, without asking the user', () => {
    const covered = lines(review, 'flaggedLocks', 'accept-locks', /decision/i);
    expect(covered.length).toBeGreaterThan(0);
    expect(covered.some((l) => /without asking|do not ask|never ask|not ask/i.test(l))).toBe(true);
    expect(covered.some((l) => l.includes('--reason'))).toBe(true);
  });

  it('names what makes a decision cover an item: the test file, the return to Test, or the pull', () => {
    const covered = lines(review, 'flaggedLocks', /decision/i).join('\n');
    expect(covered).toMatch(/test file/i);
    expect(covered).toMatch(/return to Test|back to Test/i);
    expect(covered).toMatch(/pull/i);
  });

  it('leaves an item no decision covers to the reviewer', () => {
    expect(
      lines(review, 'flaggedLocks', /reviewer/i, /no decision|not covered|none covers|no decision covers/i),
    ).not.toEqual([]);
  });

  it('dismissing a re-lock or restart finding runs accept-locks with the user reason', () => {
    const dismissal = lines(review, 'accept-locks', /dismiss/i, /reason/i);
    expect(dismissal.length).toBeGreaterThan(0);
    expect(dismissal.some((l) => /re-lock|restart/i.test(l))).toBe(true);
  });

  it('still asks about other undecided findings', () => {
    expect(lines(review, /other undecided|every other undecided|remaining undecided/i)).not.toEqual([]);
  });
});

describe('reviewer prompt treats accepted as information', () => {
  const reviewer = read('prompts/reviewer.md');

  it('lists accepted in the check-locks output', () => {
    expect(lines(reviewer, 'check-locks', 'accepted', 'lockedAfterBuild')).not.toEqual([]);
  });

  it('says accepted is information, not a finding', () => {
    const accepted = lines(reviewer, 'accepted').filter((l) => /information/i.test(l));
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.some((l) => /not a finding|do not report/i.test(l))).toBe(true);
  });

  it('keeps the user must confirm rules for what is not accepted', () => {
    expect(reviewer).toContain('acceptance test re-locked after Build began; user must confirm');
    expect(reviewer).toContain('task state was force-restarted after Build began; user must confirm locked tests');
    expect(lines(reviewer, 'lockedAfterBuild', /not accepted|unaccepted/i)).not.toEqual([]);
    expect(lines(reviewer, 'forcedRestartAfterBuild', /not accepted|unaccepted/i)).not.toEqual([]);
  });
});

describe('build and done skills use accepted items', () => {
  it('the upstream pull path ends with accept-locks --restart carrying the pull decision as the reason', () => {
    const build = read('skills/loopwright-build/SKILL.md');
    const pull = lines(build, 'Upstream check');
    expect(pull).toHaveLength(1);
    const step = pull[0]!;
    expect(step).toContain('accept-locks');
    expect(step).toContain('--restart');
    expect(step).toContain('--reason');
    expect(step.indexOf('accept-locks')).toBeGreaterThan(step.indexOf('--force --base HEAD'));
    expect(step.slice(step.indexOf('accept-locks'))).toMatch(/decision/i);
  });

  it('the PR draft lists accepted items with their reasons next to relockedAfterReopen', () => {
    const done = read('skills/loopwright-done/SKILL.md');
    const pr = lines(done, 'relockedAfterReopen', 'accepted');
    expect(pr).toHaveLength(1);
    expect(pr[0]).toMatch(/reason/i);
  });
});

describe('enforcement docs describe acceptance', () => {
  const enforcement = doc('docs/enforcement.md');

  it('says a re-lock or restart that a decision covers, or that the user dismissed, is accepted and not raised again', () => {
    const accepted = lines(enforcement, 'accept-locks').concat(lines(enforcement, /accepted/));
    const text = accepted.join('\n');
    expect(text).toMatch(/decision/i);
    expect(text).toMatch(/dismiss/i);
    expect(text).toMatch(/re-lock/i);
    expect(text).toMatch(/restart/i);
    expect(text).toMatch(/not raised again|no longer raised|raised only once|not asked again/i);
  });

  it('says a new re-lock of the same file is raised again', () => {
    expect(enforcement).toMatch(/same file[^.\n]*(raised|flagged) again/i);
  });

  it('says a faked acceptance is not detected', () => {
    expect(enforcement).toMatch(/faked acceptance[^.\n]*not detected/i);
  });
});
