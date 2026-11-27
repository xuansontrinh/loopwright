import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const reviewDocs = read('docs/workflow.md').split('## Review, step by step')[1]!.split('\n## ')[0]!;

describe('change review docs', () => {
  it('say round 1 is a full review and later rounds look at the changes', () => {
    expect(reviewDocs).toMatch(/Round 1[^\n]*full review/);
    expect(reviewDocs).toMatch(/changes since the last review/);
    expect(reviewDocs).toMatch(/earlier findings/);
    expect(reviewDocs).toMatch(/full review instead/);
  });

  it('say where the reviewed snapshot lives', () => {
    const enforcement = read('docs/enforcement.md');
    expect(enforcement).toMatch(/git object/);
    expect(enforcement).toMatch(/nothing in your working tree/i);
  });

  it('are on the dogfood list, in the README and in the benchmark results', () => {
    expect(read('docs/dogfood-checklist.md')).toMatch(/changes-only review/);
    expect(read('README.md')).toMatch(/later rounds check only what changed/);
    expect(read('docs/benchmarking.md')).toContain('### Replay of past reviews');
  });
});
