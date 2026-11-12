import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const doc = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('park docs', () => {
  it('README skills table has a /loopwright-park row', () => {
    const row = doc('README.md')
      .split('\n')
      .find((l) => /^\|\s*`\/loopwright-park`/.test(l));
    expect(row).toBeDefined();
  });

  it('workflow doc has a parking section', () => {
    const w = doc('docs/workflow.md');
    expect(w).toMatch(/^#{2,3} Parking work you find along the way$/m);
    const sec = w.split(/^#{2,3} Parking work you find along the way$/m)[1]!.split(/^#{2,3} /m)[0]!;
    expect(sec).toContain('/loopwright-park');
  });

  it('installation doc brace list includes park', () => {
    expect(doc('docs/installation.md')).toMatch(/loopwright-\{[^}]*\bpark\b[^}]*\}/);
  });

  it('enforcement doc mentions park', () => {
    expect(doc('docs/enforcement.md')).toMatch(/park/i);
  });

  it('dogfood checklist mentions park', () => {
    expect(doc('docs/dogfood-checklist.md')).toMatch(/loopwright-park|lw\.mjs park/);
  });
});
