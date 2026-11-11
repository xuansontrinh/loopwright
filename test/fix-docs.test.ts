import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const doc = (rel: string) => readFileSync(join(root, rel), 'utf8');
const lines = (body: string) => body.split('\n');
const section = (body: string, heading: RegExp) => {
  const parts = body.split(/^(?=#{2,3} )/m);
  return parts.find((p) => heading.test(p.split('\n')[0]!)) ?? '';
};
const mermaid = (body: string) => [...body.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]!);

describe('README documents the fix path', () => {
  const readme = doc('README.md');

  it('commands table lists /loopwright-fix', () => {
    const row = lines(readme).find((l) => /^\|\s*`\/loopwright-fix`/.test(l));
    expect(row).toBeDefined();
    expect(row).toMatch(/bug|fix/i);
  });

  it('limits the small-tier Test skip to features', () => {
    const skips = lines(readme).filter((l) => /small/i.test(l) && /skip/i.test(l) && /test/i.test(l));
    expect(skips.length).toBeGreaterThan(0);
    for (const l of skips) expect(l).toMatch(/feature/i);
  });

  it('flowchart shows that a fix runs Test', () => {
    const chart = mermaid(readme).find((c) => /tier/.test(c) && /Build/.test(c));
    expect(chart).toBeDefined();
    expect(chart).toMatch(/\bfix(?!-round)/i);
  });
});

describe('workflow doc documents the fix path', () => {
  const workflow = doc('docs/workflow.md');

  it('Plan chart limits the small-tier Build jump to features', () => {
    const chart = mermaid(workflow).find((c) => /Build \(small\)/.test(c));
    expect(chart).toBeDefined();
    const line = lines(chart!).find((l) => /Build \(small\)/.test(l))!;
    expect(line).toMatch(/feature/i);
  });

  it('every mention of skipping Test for small tasks names features', () => {
    for (const l of lines(workflow).filter((l) => /small/i.test(l) && /skip/i.test(l) && /test/i.test(l)))
      expect(l).toMatch(/feature/i);
  });

  it('has a fix section covering repro test, root cause, siblings and the no-repro stop', () => {
    const fix = section(workflow, /^#{2,3} .*\bfix/i);
    expect(fix).not.toBe('');
    expect(fix).toContain('/loopwright-fix');
    expect(fix).toContain('[repro]');
    expect(fix).toMatch(/root cause/i);
    expect(fix).toMatch(/sibling/i);
    expect(fix).toMatch(/no repro|cannot reproduce|stops?/i);
  });
});

describe('installation doc lists the fix skill', () => {
  it('skill list includes loopwright-fix', () => {
    const line = lines(doc('docs/installation.md')).find((l) => l.includes('.agents/skills/loopwright-'));
    expect(line).toBeDefined();
    expect(line).toMatch(/\bfix\b/);
  });
});
