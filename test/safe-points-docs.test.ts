import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(join(__dirname, '..', 'docs/workflow.md'), 'utf8');

describe('fresh context docs', () => {
  it('has a heading about fresh context', () => {
    expect(workflow.split('\n').some((l) => /^#+ .*fresh context/i.test(l))).toBe(true);
  });

  it('says what to type and names both places it is offered', () => {
    expect(workflow).toContain('`/clear`, then `/loopwright-flow`');
    expect(workflow).toMatch(/plan confirmation/i);
    expect(workflow).toMatch(/slice/i);
  });
});
