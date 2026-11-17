import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const content = (rel: string) => readFileSync(join(contentRoot(), rel), 'utf8');
const linesMatching = (text: string, re: RegExp) => text.split('\n').filter((l) => re.test(l));

describe('reviewer procedure and duplicated code', () => {
  const reviewer = () => content('prompts/reviewer.md');

  it('lists duplicated code with both locations as proof as a candidate', () => {
    expect(reviewer()).toContain('duplicated code (proof: both locations)');
  });

  it('does not report a candidate that a task decision explicitly keeps', () => {
    const line = linesMatching(reviewer(), /decision/i).find((l) => /explicitly keeps?/i.test(l));
    expect(line).toMatch(/not report/i);
  });

  it('has no rule that drops duplication inside a locked test file', () => {
    const dropping = linesMatching(reviewer(), /duplicat/i).filter(
      (l) => /locked test/i.test(l) && /(not|never) report/i.test(l),
    );
    expect(dropping).toEqual([]);
  });

  it('leaves a violation inside a locked test file Undecided', () => {
    expect(reviewer()).toMatch(/violation inside a locked test file[^\n]*Undecided/i);
  });
});

describe('simplifier procedure', () => {
  const simplifier = () => content('prompts/simplifier.md');

  it('modifies no file', () => {
    expect(simplifier()).toMatch(/do not modify any file/i);
  });

  it('scopes itself to the diff against the base commit plus untracked files', () => {
    expect(simplifier()).toMatch(/git diff <baseCommit>/);
    expect(simplifier()).toMatch(/untracked/i);
  });

  it('splits cuts into obvious and trade-off ones with lines, basis and loses', () => {
    const text = simplifier();
    expect(text).toMatch(/obvious/i);
    expect(text).toMatch(/trade-?off/i);
    for (const field of ['lines', 'basis', 'loses']) expect(text).toContain(`\`${field}\``);
  });

  it('always makes cuts in locked tests trade-off cuts', () => {
    const line = linesMatching(simplifier(), /locked test/i).find((l) => /trade-?off/i.test(l));
    expect(line).toMatch(/always/i);
  });

  it('never changes public behavior, a decision or an acceptance criterion', () => {
    expect(simplifier()).toMatch(/never[^\n]*public behavior[^\n]*decision[^\n]*acceptance criteri/i);
  });

  it('guards readability against dense one-liners, nested ternaries and merged concerns', () => {
    const text = simplifier();
    expect(text).toMatch(/one-liners/i);
    expect(text).toMatch(/nested ternar/i);
    expect(text).toMatch(/merg\w* (separate )?concerns/i);
  });

  it('returns at most 8 trade-off cuts, largest net line change first', () => {
    expect(simplifier()).toMatch(/at most 8/i);
    expect(simplifier()).toMatch(/largest[^\n]*first/i);
  });

  it('outputs exactly one JSON object with obvious and tradeoffs lists', () => {
    const text = simplifier();
    expect(text).toMatch(/exactly one JSON object/i);
    expect(text).toContain('`obvious`');
    expect(text).toContain('`tradeoffs`');
  });
});

describe('reviewer agent', () => {
  const agent = () => content('agents/reviewer.md');

  it('follows the procedure file the caller names, reviewer.md by default', () => {
    expect(agent()).toMatch(/procedure file[^\n]*caller/i);
    expect(agent()).toContain('prompts/reviewer.md');
    expect(agent()).toMatch(/default/i);
  });

  it('ends with the output the named procedure defines, not always a verdict', () => {
    expect(agent()).toMatch(/final message is[^\n]*output[^\n]*procedure/i);
    expect(agent()).not.toContain('Your final message is the JSON verdict object and nothing else.');
  });

  it('still modifies no file', () => {
    expect(agent()).toMatch(/do not modify any file/i);
  });
});

describe('implementer agent', () => {
  const agent = () => content('agents/implementer.md');

  it('takes approved simplifications as input and applies only those', () => {
    expect(agent()).toMatch(/approved simplifications[\s\S]{0,300}only those/i);
  });

  it('keeps behavior identical and writes no Root cause line on that run', () => {
    expect(agent()).toMatch(/approved simplifications[\s\S]{0,600}(identical|unchanged)/i);
    expect(agent()).toMatch(/approved simplifications[\s\S]{0,800}no `Root cause:` line/i);
  });
});

describe('tester agent', () => {
  const agent = () => content('agents/tester.md');

  it('takes approved cuts to locked tests and applies only those', () => {
    expect(agent()).toMatch(/approved cuts[\s\S]{0,300}only those/i);
  });

  it('keeps each test passing and checking the same behavior', () => {
    expect(agent()).toMatch(/approved cuts[\s\S]{0,600}same behavior/i);
    expect(agent()).toMatch(/approved cuts[\s\S]{0,600}still pass/i);
  });

  it('re-locks only the files it cut', () => {
    expect(agent()).toMatch(/approved cuts[\s\S]{0,800}re-?lock[\s\S]{0,60}only/i);
  });
});
