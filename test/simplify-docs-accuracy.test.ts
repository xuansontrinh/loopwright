import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const doc = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');
const mermaid = (text: string) => [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]!).join('\n');

describe('workflow doc Simplify paragraph', () => {
  const paragraph = () =>
    doc('docs/workflow.md')
      .split('\n')
      .find((l) => /apply[- ]all/i.test(l)) ?? '';

  it('caps trade-off cuts at 8 asked as multi-select questions of up to 4 cuts', () => {
    expect(paragraph()).toMatch(/at most 8/i);
    expect(paragraph()).toMatch(/multi-?select/i);
    expect(paragraph()).toMatch(/up to 4 cuts/i);
  });

  it('does not say trade-off cuts come one by one', () => {
    expect(paragraph()).not.toMatch(/one by one/i);
  });

  it('records every approved and declined cut as a decision', () => {
    expect(paragraph()).toMatch(/approved and declined[^.]*recorded[^.]*decision/i);
  });

  it('says an interrupted apply resumes at the apply', () => {
    expect(paragraph()).toMatch(/interrupt\w*[^.]*resum\w*[^.]*apply/i);
  });
});

describe('README chart routes Build to Simplify and Review by condition', () => {
  const chart = () => mermaid(doc('README.md'));
  const label = (to: string) =>
    new RegExp(`^\\s*build\\s*--\\s*"([^"]*)"\\s*-->\\s*${to}`, 'm').exec(chart())?.[1] ?? '';

  it('has no unconditional edge from Build to Simplify', () => {
    expect(chart()).not.toMatch(/^\s*build\s*-->\s*simplify/m);
  });

  it('labels the edge from Build to Simplify for round 1 of standard, large and fix tasks', () => {
    expect(label('simplify')).toMatch(/round 1/i);
    expect(label('simplify')).toMatch(/standard/i);
    expect(label('simplify')).toMatch(/large/i);
    expect(label('simplify')).toMatch(/fix/i);
  });

  it('labels an edge from Build to Review for small features and fix rounds', () => {
    expect(label('review')).toMatch(/small feature/i);
    expect(label('review')).toMatch(/fix round/i);
  });
});
