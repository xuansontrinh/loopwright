import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const doc = (rel: string) => readFileSync(join(root, rel), 'utf8');
const lines = (rel: string) => doc(rel).split('\n');

describe('profile question docs', () => {
  it('the flow skill gate list names the profile with the restatement', () => {
    const gate = lines('content/skills/loopwright-flow/SKILL.md').find((l) => /goal restatement/i.test(l));
    expect(gate).toMatch(/profile/i);
  });

  it('the workflow doc stops-and-waits list names the profile with the restatement', () => {
    const w = doc('docs/workflow.md');
    const list = w.split('## Where loopwright stops and waits for you')[1]!.split('\n## ')[0]!;
    expect(list).toMatch(/restatement[^\n]*profile/i);
  });

  it('the plan chart in the workflow doc asks the profile before the scout', () => {
    const w = doc('docs/workflow.md');
    const chart = w.slice(w.indexOf('in(["Goal, or an imported spec"])'));
    const restate = chart.slice(0, chart.indexOf('scout["Scout subagent'));
    expect(restate).toMatch(/profile/i);
  });

  it('the dogfood checklist has a plan line for the profile question before the scout', () => {
    expect(lines('docs/dogfood-checklist.md').some((l) => /^- \[ \] Plan[^\n]*profile[^\n]*scout/i.test(l))).toBe(true);
  });

  it('the benchmark answer sheet gives the profile answer on the restatement row', () => {
    const row = lines('docs/benchmarking.md').find((l) => l.startsWith('| Goal restatement'));
    expect(row).toMatch(/profile/i);
    expect(row).toMatch(/balanced/i);
  });

  it('the configuration doc says the scout runs at the profile chosen before it', () => {
    expect(doc('docs/configuration.md')).toMatch(
      /scout[^\n]*(profile|effort)[^\n]*chosen before|chosen before[^\n]*scout/i,
    );
  });
});
