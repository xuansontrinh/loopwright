import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const skill = (name: string) => readFileSync(contentRoot() + `skills/loopwright-${name}/SKILL.md`, 'utf8');

const section = (body: string, heading: string) => {
  const start = body.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const next = body.indexOf('\n## ', start + 1);
  return body.slice(start, next < 0 ? undefined : next);
};

const plan = skill('plan');
const input = section(plan, '## 1. Input');
const scout = section(plan, '## 2. Scout');

describe('plan restates the goal before scouting', () => {
  it('a typed goal is restated in plain words, asked in the question format, and waits for confirm or correct', () => {
    expect(input).toMatch(/restate/i);
    expect(input).toMatch(/own (plain )?words/i);
    expect(input).toMatch(/what the user wants/i);
    expect(input).toMatch(/what will change/i);
    expect(input).toMatch(/format of section 4/i);
    expect(input).toMatch(/confirm or correct/i);
  });

  it('a goal with more than one reading lists the readings as options in the same question', () => {
    expect(input).toMatch(/more than one reading[^\n]*options[^\n]*same question/i);
  });

  it('the restatement is asked on every task and never skipped for a clear-looking goal', () => {
    expect(input).toMatch(/every task/i);
    expect(input).toMatch(/never skip[^\n]*(clear|obvious)/i);
  });

  it('the restatement stands before the scout section, which spawns the scout only after it is confirmed', () => {
    expect(plan.indexOf('## 1. Input')).toBeLessThan(plan.indexOf('## 2. Scout'));
    expect(scout).toMatch(/only after the restatement is confirmed/i);
  });

  it('a bug report is restated in one sentence and its evidence intake stays after the scout', () => {
    expect(input).toMatch(/bug[^\n]*one sentence[^\n]*observed and expected/i);
    expect(input).toMatch(/evidence intake[^\n]*after the scout/i);
  });

  it('a parked stub goal is confirmed before the scout, no longer with the batch', () => {
    const parked = section(plan, '## Parked stubs');
    expect(parked).not.toMatch(/confirmed with the batch/i);
    expect(parked).toMatch(/goal is confirmed before the scout/i);
  });

  it('an imported spec and a reopened plan skip the restatement', () => {
    expect(input).toMatch(/imported spec[^\n]*reopened plan[^\n]*skip|skip[^\n]*imported spec[^\n]*reopened plan/i);
  });

  it('the confirmed restatement becomes the task goal and is recorded as an asked decision', () => {
    expect(input).toMatch(/becomes the task file's `## Goal`/i);
    expect(input).toMatch(/`\[asked\]` decision/);
  });

  it('the scout gets the goal text plus the confirmed restatement', () => {
    expect(scout).toMatch(/goal text plus the confirmed restatement/i);
    expect(scout).not.toMatch(/only the goal text/i);
  });

  it('a bug-like goal without the fix command is restated before the fix question', () => {
    const line = input.split('\n').find((l) => l.includes('Run this as a fix (repro test first)?'));
    expect(line).toBeDefined();
    expect(line).toMatch(/restatement[^.\n]*first|after the restatement/i);
  });
});

describe('goal restatement placement across skills', () => {
  for (const name of ['plan', 'flow', 'fix']) {
    it(`loopwright-${name} goal intake carries no restatement step`, () => {
      expect(section(skill(name), '## Goal intake')).not.toMatch(/restat/i);
    });
  }

  it('the flow gates list names the goal restatement', () => {
    const flow = skill('flow');
    const gates = section(flow, '## Gates: stop and wait for the user');
    expect(gates).toMatch(/goal restatement/i);
  });
});
