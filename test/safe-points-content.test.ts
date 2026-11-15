import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const skill = (name: string) => readFileSync(join(contentRoot(), 'skills', `loopwright-${name}`, 'SKILL.md'), 'utf8');
const plan = skill('plan');
const review = skill('review');
const flow = skill('flow');
const done = skill('done');

const planConfirm = plan.split('## 7. Confirm')[1]!.split('## Fix tasks')[0]!;
const reviewAfterPass = review.split('## After a pass')[1]!;

describe('safe points in the skills', () => {
  it('offers a fresh context inside the plan confirmation for standard and large tiers only', () => {
    expect(planConfirm).toContain('continue in a fresh context');
    expect(planConfirm).toMatch(/standard/);
    expect(planConfirm).toMatch(/large/);
    expect(planConfirm).toMatch(/small/);
    expect(planConfirm).toMatch(/reopened/);
    expect(planConfirm).toMatch(/small[^\n]*reopened[^\n]*keep[^\n]*no fresh.context offer/i);
  });

  it('states the fresh-context reason as a tradeoff and that the task file holds the plan', () => {
    expect(planConfirm).toMatch(/whole conversation/i);
    expect(planConfirm).toMatch(/saves tokens when much of the task remains/i);
    expect(planConfirm).toMatch(/can cost more than it saves on a short task/i);
    expect(planConfirm).toMatch(/task file holds the plan/i);
  });

  it('asks at a slice boundary only when a todo slice remains, for the large tier', () => {
    expect(reviewAfterPass).toMatch(/\[todo\] slice remains/);
    expect(reviewAfterPass).toContain('continue in a fresh context');
    expect(reviewAfterPass).toMatch(/not asked[^\n]*last slice/i);
    expect(reviewAfterPass).toMatch(/not asked[^\n]*whole-branch/i);
  });

  it('advances to Test before the turn ends', () => {
    expect(planConfirm).toContain('lw.mjs" stage test');
    expect(reviewAfterPass).toContain('lw.mjs" stage test');
  });

  it('writes Notes for Done before a reset and Done reads them', () => {
    expect(planConfirm).toContain('## Notes for Done');
    expect(reviewAfterPass).toContain('## Notes for Done');
    expect(done).toContain('## Notes for Done');
    expect(done.split('## 1. Knowledge')[1]!.split('## 2.')[0]).toContain('## Notes for Done');
  });

  it('writes the notes before the stage is advanced', () => {
    for (const s of [planConfirm, reviewAfterPass]) {
      expect(s.indexOf('## Notes for Done')).toBeGreaterThan(-1);
      expect(s.indexOf('## Notes for Done')).toBeLessThan(s.indexOf('lw.mjs" stage test'));
    }
  });

  it('tells the user what to type', () => {
    for (const s of [planConfirm, reviewAfterPass]) expect(s).toContain('`/clear`, then `/loopwright-flow`');
  });

  it('carries on in the same session if the user does not clear', () => {
    for (const s of [planConfirm, reviewAfterPass]) {
      expect(s).toMatch(/same session[^\n]*continue with `\/loopwright-test`/);
    }
  });

  it('lists the slice-boundary question as a gate and says a fresh-context answer ends the turn', () => {
    expect(flow.split('## Gates')[1]).toContain('fresh context');
    expect(flow.split('## Run')[1]!.split('## Gates')[0]).toContain('fresh context');
  });
});
