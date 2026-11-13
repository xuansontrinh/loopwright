import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const skill = (name: string) => readFileSync(contentRoot() + `skills/loopwright-${name}/SKILL.md`, 'utf8');
const LW = 'node "{{LW_HOME}}/hooks/lw.mjs"';

/** The "Goal intake" section, up to the next heading. */
const intake = (name: string) => {
  const body = skill(name);
  const start = body.indexOf('## Goal intake');
  expect(start).toBeGreaterThan(-1);
  const next = body.indexOf('\n## ', start + 1);
  return body.slice(start, next < 0 ? undefined : next);
};

describe('goal intake while this worktree has a task in build or review', () => {
  for (const name of ['flow', 'plan', 'fix']) {
    it(`loopwright-${name} sets the wait first, before any question, message or bullet`, () => {
      const body = intake(name);
      const wait = body.indexOf(`${LW} await-user "handing a new goal to a new worktree"`);
      expect(wait).toBeGreaterThan(-1);
      expect(body).toMatch(/First step, before any question or message/);
      expect(body).toMatch(/task in `build` or `review`/);
      expect(wait).toBeLessThan(body.indexOf('- A related task in this worktree'));
      expect(wait).toBeLessThan(body.indexOf(`${LW} worktree`));
    });

    it(`loopwright-${name} never resumes inside goal intake and leaves the clearing to the task's own work`, () => {
      const body = intake(name);
      expect(body).toMatch(/Never run `resume` in goal intake/);
      expect(body).toMatch(/wait clears when that task's own work resumes/);
      expect(body).not.toMatch(new RegExp(`${LW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} resume`));
      expect(body).not.toMatch(/Run `resume`/);
      expect(body).not.toMatch(/wait still set/);
    });
  }

  it('the three skills carry the same first step text', () => {
    const step = (name: string) => intake(name).match(/^First step[^\n]*$/m)?.[0];
    expect(step('flow')).toBeTruthy();
    expect(step('plan')).toBe(step('flow'));
    expect(step('fix')).toBe(step('flow'));
  });
});
