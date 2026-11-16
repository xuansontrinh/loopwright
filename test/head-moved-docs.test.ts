import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const doc = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const section = (text: string, heading: string) => text.split(heading)[1]!.split('\n## ')[0]!;
const movedBranch = /moved[- ]branch|branch (has )?moved|head moved/i;

describe('the moved-branch gate is listed with the other gates', () => {
  it('the flow skill Gates list names it', () => {
    const flow = readFileSync(contentRoot() + 'skills/loopwright-flow/SKILL.md', 'utf8');
    expect(section(flow, '## Gates: stop and wait for the user')).toMatch(movedBranch);
  });

  it('the workflow doc stops-and-waits list names it', () => {
    const list = section(doc('docs/workflow.md'), '## Where loopwright stops and waits for you');
    expect(list.split('\n').filter((l) => movedBranch.test(l))).not.toEqual([]);
  });

  it('the dogfood checklist has a line for it', () => {
    expect(
      doc('docs/dogfood-checklist.md')
        .split('\n')
        .some((l) => /^- \[ \]/.test(l) && movedBranch.test(l)),
    ).toBe(true);
  });

  it('the benchmark answer sheet has a row for it, answered pulled, leave them out', () => {
    const rows = doc('docs/benchmarking.md')
      .split('\n')
      .filter((l) => l.startsWith('|') && movedBranch.test(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/pulled/i);
    expect(rows[0]).toMatch(/leave them out/i);
  });
});
