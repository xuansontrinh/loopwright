import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const doc = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');
const section = (text: string, heading: RegExp) => {
  const parts = text.split(/^(?=#{2,3} )/m);
  const at = parts.findIndex((p) => heading.test(p.split('\n')[0]!));
  return at < 0 ? '' : parts[at]!;
};
const mermaid = (text: string) => [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]!).join('\n');
const SIMPLIFY = /simplif/i;

describe('simplify docs', () => {
  it('lists the Simplify question in the flow skill gates', () => {
    const flow = readFileSync(join(contentRoot(), 'skills/loopwright-flow/SKILL.md'), 'utf8');
    expect(section(flow, /^## Gates/)).toMatch(SIMPLIFY);
  });

  it('lists the Simplify question where loopwright stops and waits', () => {
    expect(section(doc('docs/workflow.md'), /^## Where loopwright stops and waits for you/)).toMatch(SIMPLIFY);
  });

  it('names the step in the Review chart of the workflow doc', () => {
    expect(mermaid(section(doc('docs/workflow.md'), /^## Review, step by step/))).toMatch(SIMPLIFY);
  });

  it('names the step in the README chart and stage bullets', () => {
    const readme = doc('README.md');
    expect(mermaid(readme)).toMatch(SIMPLIFY);
    expect(readme).toMatch(/^- \*\*Simplify/m);
  });

  it('has exactly one checklist line for it in the dogfood checklist', () => {
    const lines = doc('docs/dogfood-checklist.md')
      .split('\n')
      .filter((l) => /^- \[ \]/.test(l) && SIMPLIFY.test(l));
    expect(lines).toHaveLength(1);
  });

  it('has exactly one answer-sheet row for it in the benchmarking doc', () => {
    const rows = section(doc('docs/benchmarking.md'), /^## Answer sheet/)
      .split('\n')
      .filter((l) => l.startsWith('|') && SIMPLIFY.test(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('apply all obvious cuts, decline all trade-off cuts');
  });

  it('documents the simplify key in the configuration JSON block and key list', () => {
    const config = doc('docs/configuration.md');
    expect(/```json\n([\s\S]*?)```/.exec(config)?.[1]).toContain('"simplify": true');
    expect(config).toMatch(/^- `simplify`:/m);
  });
});
