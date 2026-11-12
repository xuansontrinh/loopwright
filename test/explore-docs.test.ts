import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const doc = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('explore docs', () => {
  it('README has a /loopwright-explore commands row and a pitch-line mention', () => {
    const readme = doc('README.md');
    const row = readme.split('\n').find((l) => /^\|\s*`\/loopwright-explore`/.test(l));
    expect(row).toBeTruthy();
    expect(readme.split('/loopwright-explore').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('workflow doc has the unfamiliar-codebase section', () => {
    const w = doc('docs/workflow.md');
    const m = /^#{2,3} Understanding an unfamiliar codebase\s*$/m.exec(w);
    expect(m).toBeTruthy();
    const sec = w.slice(m!.index).split(/\n#{2,3} (?!Understanding)/)[0]!;
    expect(sec).toContain('/loopwright-explore');
  });

  it('installation doc brace list includes explore', () => {
    expect(doc('docs/installation.md')).toMatch(/loopwright-\{[^}]*\bexplore\b[^}]*\}/);
  });

  it('enforcement doc mentions explore', () => {
    expect(doc('docs/enforcement.md')).toMatch(/explore/i);
  });

  it('dogfood checklist mentions explore', () => {
    expect(doc('docs/dogfood-checklist.md')).toMatch(/loopwright-explore|lw\.mjs explore/);
  });
});
