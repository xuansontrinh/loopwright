import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const plan = readFileSync(contentRoot() + 'skills/loopwright-plan/SKILL.md', 'utf8');

const section = (heading: string) => {
  const start = plan.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const next = plan.indexOf('\n## ', start + 1);
  return plan.slice(start, next < 0 ? undefined : next);
};

const input = section('## 1. Input');
const scout = section('## 2. Scout');
const ledger = section('## 3. Assumption ledger');
const proposal = section('## 6. Proposal');

describe('plan asks the profile before the scout', () => {
  it('the profile is asked in the same prompt as the goal restatement, recommended profile first', () => {
    expect(input).toMatch(
      /profile[^\n]*same (prompt|question)[^\n]*restatement|restatement[^\n]*same (prompt|question)[^\n]*profile/i,
    );
    expect(input).toMatch(/recommend[^\n]*first/i);
  });

  it('the recommendation comes from the goal restatement and is balanced when the size is not shown', () => {
    expect(input).toMatch(/best guess|recommend[^\n]*restatement/i);
    expect(input).toMatch(/balanced[^\n]*(does not|doesn't|not)[^\n]*(size|show)/i);
  });

  it('the user has the last say on the profile', () => {
    expect(input).toMatch(/last say|confirm or change/i);
  });

  it('an imported spec gets the profile question on its own and a reopened plan gets none', () => {
    expect(input).toMatch(/imported spec[^\n]*profile[^\n]*(own|alone|on its own)/i);
    expect(input).toMatch(/reopened[^\n]*(no|none|nothing|not)[^\n]*profile|profile[^\n]*reopened/i);
  });
});

describe('plan passes the chosen profile to the first scout', () => {
  it('the first scout spawn takes effort from effort scout with the chosen profile', () => {
    expect(scout).toContain('lw.mjs" effort scout --profile');
  });

  it('follow-up scouts keep the plain effort command', () => {
    expect(scout).toMatch(/follow-up[^\n]*lw\.mjs" effort scout`?(?!\s*--profile)/i);
  });
});

describe('plan records the chosen profile in the header', () => {
  it('the task file is created with the profile already chosen', () => {
    expect(ledger).toMatch(/profile/i);
    expect(ledger).toMatch(/chosen|asked/i);
  });

  it('the proposal lists the profile pre-filled and says so when the scout findings suggest another', () => {
    expect(proposal).toMatch(/pre-?filled/i);
    expect(proposal).toMatch(/scout[^\n]*(suggest|findings)/i);
  });
});
