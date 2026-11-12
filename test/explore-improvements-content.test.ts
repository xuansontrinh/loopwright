import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');
const skill = () => read('skills/loopwright-explore/SKILL.md');
const scout = () => read('agents/scout.md');
const doc = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const exploreDocSection = () => {
  const w = doc('docs/workflow.md');
  const m = /^#{2,3} Understanding an unfamiliar codebase\s*$/m.exec(w)!;
  return w.slice(m.index).split(/\n#{2,3} (?!Understanding)/)[0]!;
};
// The scout's Explore tasks section, split by "Mode ..." paragraphs.
const scoutMode = (mode: RegExp) => {
  const body = scout();
  const start = body.search(mode);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = body.slice(start + 1);
  const next = rest.search(/\n(Mode |## )/);
  return body.slice(start, next < 0 ? undefined : start + 1 + next);
};
describe('explore answer pass', () => {
  it('skill spawns a scout in answer mode with only the question list, between Draft and Check', () => {
    const body = skill();
    expect(body).toContain('Explore tasks: answer');
    expect(body).toMatch(/only the question list/i);
    const stages = body.split(/^## Stages/m)[1]!;
    const draft = stages.indexOf('Draft:');
    const answer = stages.indexOf('Explore tasks: answer');
    const check = stages.indexOf('Explore tasks: check');
    expect(draft).toBeGreaterThanOrEqual(0);
    expect(answer).toBeGreaterThan(draft);
    expect(check).toBeGreaterThan(answer);
  });

  it('skill routes answered, problem and open results', () => {
    const text = skill().split(/^## Stages/m)[1]!;
    const around = text.slice(text.indexOf('Explore tasks: answer'), text.indexOf('Explore tasks: check'));
    expect(around).toContain('`answered`');
    expect(around).toContain('`problem`');
    expect(around).toContain('`open`');
    expect(around).toContain('claims.md');
    expect(around).toContain('Possible problems found');
    expect(around).toContain('Questions only the team can answer');
  });

  it('scout has an answer mode that searches docs, guidance files, tests and read-only git', () => {
    const mode = scoutMode(/Mode answer/);
    expect(mode).toMatch(/CLAUDE\.md/);
    expect(mode).toMatch(/AGENTS\.md/);
    expect(mode).toMatch(/docs/i);
    expect(mode).toMatch(/tests/i);
    expect(mode).toMatch(/read-only git|git history/i);
    expect(mode).toMatch(/no repo commands|run no|do not run/i);
  });

  it('scout answer mode returns Q<n> lines in three shapes', () => {
    const mode = scoutMode(/Mode answer/);
    expect(mode).toContain('Q<n>: answered — ');
    expect(mode).toContain('Q<n>: problem — ');
    expect(mode).toContain('Q<n>: open — ');
    expect(mode).toMatch(/path:line/);
  });
});

describe('explore walkthrough sections', () => {
  const walk = () =>
    skill()
      .split(/^## The walkthrough/m)[1]!
      .split(/^Writing rules:/m)[0]!;

  it('has 13 sections with the split questions', () => {
    const w = walk();
    expect(w).toMatch(/^11\. Possible problems found/m);
    expect(w).toMatch(/^12\. Questions only the team can answer/m);
    expect(w).toMatch(/^13\. Evidence/m);
    expect(w).not.toMatch(/^1[12]\. Questions for the team/m);
  });

  it('questions gate asks only about the questions only the team can answer', () => {
    const gate = skill().split(/^## Stages/m)[1]!;
    const g = gate.slice(gate.indexOf('Questions gate'));
    expect(g).toContain('Questions only the team can answer');
    expect(g).toContain('Possible problems found');
    expect(g).toMatch(/only (about )?(section 12|"?Questions only the team can answer)/i);
  });
});

describe('explore narrower check result', () => {
  it('scout check mode defines the narrower line', () => {
    const mode = scoutMode(/Mode check/);
    expect(mode).toContain('C<n>: narrower — ');
    expect(mode).toMatch(/narrower — [^\n]*path:line/);
  });

  it('skill narrows the claim or folds the caveat in, without re-check, and counts narrower', () => {
    const body = skill();
    const check = body.slice(body.indexOf('Explore tasks: check'), body.indexOf('Questions gate'));
    expect(check).toContain('narrower');
    expect(check).toMatch(/narrow[^\n]*claim|fold/i);
    expect(check).toMatch(/caveat/i);
    expect(check).toMatch(/not re-checked|no re-check/i);
    expect(check).toMatch(/count/i);
  });
});

describe('explore dirty working tree', () => {
  it('skill reads dirty from lw.mjs explore and raises it at the outline gate', () => {
    const body = skill();
    expect(body).toContain('dirty');
    const setup = body.split(/^## Setup/m)[1]!.split(/^## Stages/m)[0]!;
    expect(setup).toMatch(/\{[^}]*dirty[^}]*\}/);
    const stages = body.split(/^## Stages/m)[1]!;
    const gate = stages.slice(stages.indexOf('Outline gate'), stages.indexOf('Components:'));
    expect(gate).toMatch(/dirty|uncommitted/i);
    expect(gate).toMatch(/commit/i);
    expect(gate).toMatch(/stash/i);
  });

  it('going on records plus uncommitted changes in N files in the header', () => {
    expect(skill()).toContain('plus uncommitted changes in N files');
  });
});

describe('explore optional diagrams', () => {
  const comp = () => {
    const w = skill().split(/^## The walkthrough/m)[1]!;
    const m = /^7\. Components[\s\S]*?(?=^8\. )/m.exec(w);
    return m?.[0] ?? '';
  };

  it('section 7 allows a zoom diagram for a component with 4 or more internal parts', () => {
    const c = comp();
    expect(c).toMatch(/zoom/i);
    expect(c).toMatch(/4 or more internal parts/);
    expect(c).toMatch(/call each other/);
  });

  it('section 7 allows one data (ER) diagram when 2 or more components own data', () => {
    const c = comp();
    expect(c).toMatch(/ER/);
    expect(c).toMatch(/2 or more components/);
    expect(c).toMatch(/data/i);
  });

  it('optional diagrams follow the same box, edge-table and check rules', () => {
    expect(comp()).toMatch(/same[^\n]*(box|edge)/i);
  });

  it('scout component mode has an Internal parts line', () => {
    expect(scoutMode(/Mode component/)).toMatch(/^Internal parts: .*path:line/m);
  });
});

describe('explore docs for the improvements', () => {
  it('workflow doc covers answer pass, narrower, dirty-tree check and the split sections', () => {
    const s = exploreDocSection();
    expect(s).toMatch(/answer/i);
    expect(s).toContain('narrower');
    expect(s).toMatch(/uncommitted/i);
    expect(s).toContain('Possible problems found');
    expect(s).toContain('Questions only the team can answer');
  });

  it('dogfood checklist has explore items for the answer pass and the dirty tree', () => {
    const d = doc('docs/dogfood-checklist.md');
    const m = /^### Explore path\s*$/m.exec(d)!;
    expect(m).toBeTruthy();
    const sec = d.slice(m.index).split(/\n#{2,3} (?!Explore path)/)[0]!;
    expect(sec).toMatch(/answer/i);
    expect(sec).toMatch(/dirty|uncommitted/i);
  });
});
