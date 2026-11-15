import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const doc = (rel: string) => readFileSync(join(root, rel), 'utf8');
const lines = (rel: string) => doc(rel).split('\n');

describe('goal restatement docs', () => {
  it('the plan chart in the workflow doc restates the goal before the scout', () => {
    const w = doc('docs/workflow.md');
    const chart = w.slice(w.indexOf('in(["Goal, or an imported spec"])'));
    const restate = chart.search(/restat/i);
    expect(restate).toBeGreaterThan(-1);
    expect(restate).toBeLessThan(chart.indexOf('scout["Scout subagent'));
  });

  it('the workflow doc stops-and-waits list names the restatement', () => {
    const w = doc('docs/workflow.md');
    const list = w.split('## Where loopwright stops and waits for you')[1]!.split('\n## ')[0]!;
    expect(list).toMatch(/restat/i);
  });

  it('the README plan description mentions the restatement', () => {
    expect(lines('README.md').find((l) => l.startsWith('- **Plan**'))).toMatch(/restat/i);
  });

  it('the dogfood checklist has a plan line for the restatement', () => {
    expect(lines('docs/dogfood-checklist.md').some((l) => /^- \[ \] Plan[^\n]*restat/i.test(l))).toBe(true);
  });

  it('the benchmark answer sheet has a row for the restatement', () => {
    expect(lines('docs/benchmarking.md').some((l) => /^\|[^\n]*restat/i.test(l))).toBe(true);
  });
});
