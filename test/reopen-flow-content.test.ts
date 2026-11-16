import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');
const lineWith = (body: string, needle: RegExp) => body.split('\n').find((l) => needle.test(l)) ?? '';

describe('going back keeps the task file header in step', () => {
  it.each(['flow', 'build', 'review'])('loopwright-%s leaves the header stage and plan: draft to reopen', (name) => {
    const line = lineWith(read(`skills/loopwright-${name}/SKILL.md`), /lw\.mjs" reopen <plan/);
    expect(line).toContain('sets the header `stage:`');
    expect(line).toContain('`plan: draft`');
    expect(line).toContain('"header": false');
  });

  it('plan skill resumes a reopened task for the added scope and keeps the base commit', () => {
    const body = read('skills/loopwright-plan/SKILL.md');
    expect(lineWith(body, /reopen. event/)).toMatch(/not a second task/);
    expect(lineWith(body, /unless the task was reopened/)).toContain('start tasks/<file>.md --force');
  });
});

describe('test stage after a reopen', () => {
  it('test skill scopes a reopened task by its reason and lets the tester re-lock', () => {
    const body = read('skills/loopwright-test/SKILL.md');
    expect(lineWith(body, /Reopened task \(/)).toMatch(/not the first `\[todo\]` slice/);
    expect(lineWith(body, /Never re-lock/)).toContain('after a reopen');
    expect(lineWith(body, /Every in-scope AC/)).toMatch(/may pass/);
  });

  it('tester may edit and re-lock tests in a reopened scope and report passing ones', () => {
    const body = read('agents/tester.md');
    expect(body).toMatch(/Reopened task[^\n]*edit the existing locked tests/);
    expect(body).toMatch(/Reopened task:[^\n]*may pass now/);
  });
});
