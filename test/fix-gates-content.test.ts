import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');
const lineWith = (body: string, needle: RegExp) => body.split('\n').find((l) => needle.test(l)) ?? '';

describe('a bug-like goal is never turned into a fix silently', () => {
  it('plan skill asks before switching to kind fix', () => {
    const line = lineWith(read('skills/loopwright-plan/SKILL.md'), /looks like a bug/);
    expect(line).toContain('never switch silently');
    expect(line).toContain('Run this as a fix (repro test first)?');
    expect(line).not.toContain('without asking');
  });

  it('flow skill lists the question among the gates and credits Plan after the user agrees', () => {
    const body = read('skills/loopwright-flow/SKILL.md');
    expect(lineWith(body, /"run this as a fix\?" question/)).toContain('bug-like goal');
    expect(lineWith(body, /by Plan after the user agrees/)).toContain('kind: fix');
  });
});

describe('sibling gate and fix rounds in review', () => {
  const body = read('skills/loopwright-review/SKILL.md');

  it('counts rounds only after the last scope change', () => {
    const line = lineWith(body, /Round `n` =/);
    expect(line).toContain('after the last `- Scope change:` line');
    expect(line).toContain('all of them if there is none');
  });

  it('stops when the fix-round cap is reached or exceeded', () => {
    expect(lineWith(body, /Fix rounds used = n/)).toContain('reaches or exceeds');
  });

  it('asks the sibling gate once, at the final pass, never after a slice review', () => {
    const line = lineWith(body, /sibling gate: asked once/);
    expect(line).toContain('at the final pass');
    expect(line).toContain('whole-branch review for large');
    expect(line).toContain('never after a slice review');
  });

  it('slice reviews record Sibling lines that the final pass collects', () => {
    expect(lineWith(body, /records its merged `siblings`/)).toContain('- Sibling <path>:<line> — <why>');
    const final = lineWith(body, /At the final pass, take/);
    expect(final).toContain('every `Sibling` line after the last `- Scope change:` line');
    expect(final).toContain('await-user');
  });

  it('including siblings logs a scope change and reopens plan with a fresh budget', () => {
    const line = lineWith(body, /Include → append/);
    expect(line).toContain('- Scope change: siblings included');
    expect(line).toContain('reopen plan');
    expect(line).toContain('fresh fix-round budget');
  });
});
