import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const content = (rel: string) => readFileSync(join(contentRoot(), rel), 'utf8');
const doc = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');
const STANDARDS_REF = '{{LW_HOME}}/prompts/standards.md';
const COMMENT_RULE =
  'Comments explain why, briefly. State each rationale in exactly one place. Never restate what the code does.';

describe('shared standards file', () => {
  const s = () => content('prompts/standards.md');

  it('lets the repo docs on architecture and conventions win on conflict', () => {
    const text = s();
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'ARCHITECTURE.md', 'README.md', 'CONTRIBUTING.md', 'docs/']) {
      expect(text).toContain(f);
    }
    expect(text).toMatch(/win/i);
  });

  it('names each rule', () => {
    const text = s();
    for (const rule of [
      /existing mechanism first/i,
      /fewest clear lines/i,
      /respect the layers/i,
      /no trivial wrappers/i,
      /delete what you replace/i,
      /validate at the boundaries/i,
      /no speculative generality/i,
      /one home per fact/i,
      /no change-log comments/i,
      /leave existing docs alone/i,
      /test name carries the behavior/i,
    ]) {
      expect(text).toMatch(rule);
    }
  });

  it('gives a why for each rule', () => {
    expect((s().match(/\bWhy:/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });

  it('sends environment differences to config, not code branching on the environment name', () => {
    expect(s()).toMatch(/environment[\s\S]{0,200}config[\s\S]{0,200}never[\s\S]{0,80}branch/i);
  });

  it('draws the layers from the same repo docs', () => {
    expect(s()).toMatch(/layers[^\n]*(AGENTS\.md|docs)/i);
  });

  it('holds the comment rule verbatim', () => {
    expect(s()).toContain(COMMENT_RULE);
  });
});

describe('agents and reviewer read the standards', () => {
  it.each(['agents/tester.md', 'agents/implementer.md', 'prompts/reviewer.md'])(
    '%s references the standards file',
    (f) => {
      expect(content(f)).toContain(STANDARDS_REF);
    },
  );

  it.each(['agents/implementer.md', 'prompts/reviewer.md'])('%s no longer carries the comment rule sentence', (f) => {
    expect(content(f)).not.toContain('State each rationale in exactly one place');
  });
});

describe('tester standards pass', () => {
  const t = () => content('agents/tester.md');

  it('runs a standards pass before the lock step', () => {
    const text = t();
    const pass = text.search(/standards pass/i);
    const lock = text.search(/lw\.mjs" lock/);
    expect(pass).toBeGreaterThanOrEqual(0);
    expect(pass).toBeLessThan(lock);
  });

  it('may edit and re-lock its own tests when re-dispatched during Test-stage verification', () => {
    const text = t();
    expect(text).toMatch(/re-dispatched[\s\S]{0,300}re-lock/i);
    expect(text).toContain('edit the existing locked tests');
  });
});

describe('Test skill verification', () => {
  const k = () => content('skills/loopwright-test/SKILL.md');

  it('checks new test files for comments or doc blocks restating a name or criterion', () => {
    const text = k();
    expect(text).toMatch(/comments or doc blocks/i);
    expect(text).toMatch(/restat/i);
  });

  it('re-dispatches the tester before Build and allows the re-lock, still only after a reopen otherwise', () => {
    const text = k();
    expect(text).toMatch(/restat[\s\S]{0,400}(tester|loopwright-tester)[\s\S]{0,300}before Build/i);
    expect(text).toContain('after a reopen');
    expect(text).toMatch(/re-?dispatch[\s\S]{0,200}re-?lock|re-?lock[\s\S]{0,300}re-?dispatch/i);
  });
});

describe('implementer simplify pass', () => {
  it('simplifies its diff against the base commit after the checks pass and reruns the checks', () => {
    const text = content('agents/implementer.md');
    expect(text).toMatch(/simplify pass/i);
    expect(text).toMatch(/base commit/i);
    expect(text).toMatch(/rerun the checks/i);
  });
});

describe('reviewer standards checks', () => {
  const r = () => content('prompts/reviewer.md');

  it('has a duplicated-docs check proved by both locations', () => {
    const text = r();
    expect(text).toMatch(/duplicated docs/i);
    expect(text).toMatch(/both locations/i);
    expect(text).toMatch(/remove the new copy/i);
  });

  it('has a bypassed-mechanism check proved by the mechanism path:line', () => {
    const text = r();
    expect(text).toMatch(/bypassed mechanism/i);
    expect(text).toMatch(/mechanism[^\n]*path:line/i);
  });

  it('requires the smaller version for a simplicity finding', () => {
    expect(r()).toMatch(/smaller version/i);
  });

  it('treats a proven named-rule violation as Blocking and drops an unproven one', () => {
    const text = r();
    expect(text).toMatch(/named rule[\s\S]{0,300}high impact/i);
    expect(text).toMatch(/Blocking/);
    expect(text).toMatch(/(without|no) (that )?proof[\s\S]{0,100}dropped/i);
  });
});

describe('scout report lines', () => {
  const body = () => content('agents/scout.md');

  it('Plan-mode report has Mechanisms and Layers lines', () => {
    const report = body().split('\n## Report')[1] ?? '';
    expect(report).toMatch(/^Mechanisms:/m);
    expect(report).toMatch(/^Layers:/m);
  });

  it('explore-mode reports do not', () => {
    const before = body().split('\n## Report')[0]!;
    expect(before).not.toMatch(/^Mechanisms:/m);
    expect(before).not.toMatch(/^Layers:/m);
  });
});

describe('Plan ledger', () => {
  it('covers extending an existing mechanism vs adding something new, and environment differences as high impact', () => {
    const text = content('skills/loopwright-plan/SKILL.md');
    expect(text).toMatch(/existing mechanism[\s\S]{0,200}(adding|new)/i);
    expect(text).toMatch(/environment, deployment or tenant/i);
    expect(text).toMatch(/environment, deployment or tenant[\s\S]{0,300}high-impact/i);
    expect(text).toMatch(/Mechanisms/);
  });
});

describe('Done knowledge step', () => {
  it('links instead of restating a fact already in the repo docs or contract', () => {
    const text = content('skills/loopwright-done/SKILL.md');
    expect(text).toMatch(/already stated in[^\n]*(docs|contract)/i);
    expect(text).toMatch(/link instead of restating/i);
  });
});

describe('docs', () => {
  it('workflow names the shared standards file', () => {
    expect(doc('docs/workflow.md')).toContain('prompts/standards.md');
  });

  it('enforcement describes the Test-stage check before Build and that proven standards violations block', () => {
    const text = doc('docs/enforcement.md');
    expect(text).toMatch(/standards/i);
    expect(text).toMatch(/restat[\s\S]{0,300}before Build|before Build[\s\S]{0,300}restat/i);
    expect(text).toMatch(/standards[\s\S]{0,300}block|block[\s\S]{0,300}standards/i);
  });
});
