import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const skill = (name: string) => readFileSync(`${contentRoot()}skills/loopwright-${name}/SKILL.md`, 'utf8');
const doc = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const section = (body: string, heading: string) => {
  const start = body.indexOf(heading);
  expect(start, `heading "${heading}"`).toBeGreaterThanOrEqual(0);
  const rest = body.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
};
const GO_BACK = /go(ing)? back/i;

describe('going back from Done', () => {
  const done = skill('done');
  const reopenLine = done.split('\n').find((l) => /lw\.mjs" reopen/.test(l));

  it('done skill runs await-user, resume and reopen in that order and offers Plan, Test or staying in Done', () => {
    const wait = done.indexOf('lw.mjs" await-user');
    const resume = done.indexOf('lw.mjs" resume');
    const reopen = done.search(/lw\.mjs" reopen/);
    expect(wait).toBeGreaterThanOrEqual(0);
    expect(resume).toBeGreaterThan(wait);
    expect(reopen).toBeGreaterThan(resume);
    expect(done).toMatch(/directly (after|follow\w*)[^\n]*`?resume`?|`resume`[^\n]*directly/i);
    expect(done).toMatch(/only after the user chooses/i);
    expect(done).toMatch(/stay in Done/i);
  });

  it('done skill sets the header on go-back as build and review do', () => {
    expect(reopenLine).toBeDefined();
    expect(reopenLine).toContain('sets the header `stage:`');
    expect(reopenLine).toContain('`plan: draft`');
    expect(reopenLine).toContain('"header": false');
  });

  it('done skill logs a scope change before the reopen and records the go-back as an asked decision', () => {
    const scope = done.indexOf('- Scope change:');
    expect(scope).toBeGreaterThanOrEqual(0);
    expect(scope).toBeLessThan(done.search(/lw\.mjs" reopen/));
    expect(done).toMatch(/\[asked\][^\n]*reason|reason[^\n]*\[asked\]/i);
  });

  it('done skill offers go-back only before Close, keeps applied edits and recommends Test or Plan by what changes', () => {
    expect(done).toMatch(/before (Close|`?lw\.mjs" done`?)/);
    expect(done).toMatch(/AGENTS\.md[^\n]*kept|kept[^\n]*AGENTS\.md/i);
    expect(done).toMatch(/next review/i);
    expect(done).toMatch(/Test[^\n.]*only a test or the code/i);
    expect(done).toMatch(/Plan[^\n.]*(decision|acceptance criterion|scope)/i);
  });

  it('flow skill names Done in its go-back line, its await-user sentence and its Gates list', () => {
    const flow = skill('flow');
    const lines = flow.split('\n');
    expect(lines.find((l) => l.includes('reopen <plan|test>'))).toMatch(/Done/);
    expect(lines.find((l) => /await-user/.test(l) && /Test \(no-repro gate\)/.test(l))).toMatch(/Done/);
    const gates = section(flow, '## Gates: stop and wait for the user');
    expect(gates.split('\n').find((l) => GO_BACK.test(l) && /Done/.test(l))).toBeDefined();
  });

  it('docs name going back from Done in the stop list, the enforcement go-back section and the dogfood checklist', () => {
    const stops = section(doc('docs/workflow.md'), '## Where loopwright stops and waits for you');
    expect(stops.split('\n').find((l) => GO_BACK.test(l) && /Done/.test(l))).toBeDefined();
    const enforcement = section(doc('docs/enforcement.md'), '## Going back after Build began');
    expect(enforcement).toMatch(/Done/);
    const checklist = doc('docs/dogfood-checklist.md')
      .split('\n')
      .filter((l) => l.startsWith('- [ ]'));
    expect(checklist.find((l) => /Done/.test(l) && /go(ing)? back|reopen/i.test(l))).toBeDefined();
  });
});
