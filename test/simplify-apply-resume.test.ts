import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const content = (rel: string) => readFileSync(join(contentRoot(), rel), 'utf8');
const section = (text: string, heading: string) => {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start < 0) return '';
  const rest = text.slice(start + 1);
  return rest.slice(0, rest.indexOf('\n## ', 1) < 0 ? undefined : rest.indexOf('\n## ', 1));
};
const PENDING = 'apply pending';

describe('review skill Simplify: record every approved cut', () => {
  const simplify = section(content('skills/loopwright-review/SKILL.md'), 'Simplify');
  const templates = simplify
    .split('D<n> [asked] Simplify:')
    .slice(1)
    .map((t) => t.split(/[`\n]/)[0]!.trim());

  it('gives each approved trade-off decision its location', () => {
    const approved = templates.filter((t) => !/^(kept as written|apply obvious)/.test(t));
    expect(approved.length).toBeGreaterThan(0);
    for (const t of approved) expect(t).toContain('<location>');
  });

  it('records the approved obvious cuts on one decision line with location and change', () => {
    expect(simplify).toMatch(/D<n> \[asked\] Simplify: apply obvious: <location> — <change>;/);
  });
});

describe('review skill Simplify: an interrupted apply resumes at the apply', () => {
  const simplify = section(content('skills/loopwright-review/SKILL.md'), 'Simplify');
  const beforePropose = simplify.slice(0, simplify.indexOf('**Propose'));
  const fromApply = simplify.slice(simplify.indexOf('**Apply**'));

  it('writes the log line ending in apply pending when any cut is approved', () => {
    const line = simplify.split('\n').find((l) => /- Simplify:[^\n]*— apply pending/.test(l));
    expect(line).toMatch(/approved|any cut/i);
  });

  it('removes the apply pending ending once the last apply branch is done', () => {
    expect(fromApply.startsWith('**Apply**')).toBe(true);
    expect(fromApply).toMatch(/remov\w*[^\n]*— apply pending/i);
  });

  it('does not skip a Simplify line ending in apply pending and resumes at the apply', () => {
    expect(beforePropose).toContain(PENDING);
    expect(beforePropose).toMatch(/resum\w* at[^\n]*apply/i);
  });
});

describe('build and test setup finish a pending Simplify apply in review', () => {
  it('build sends the session to review before the moved-branch and upstream checks', () => {
    const build = section(content('skills/loopwright-build/SKILL.md'), 'Setup');
    const at = build.indexOf(PENDING);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(build.indexOf('Moved branch.'));
    expect(at).toBeLessThan(build.indexOf('Upstream check.'));
    const line = build.split('\n').find((l) => l.includes(PENDING));
    expect(line).toContain('/loopwright-review');
  });

  it('test sends the session to review before it spawns the tester', () => {
    const test = content('skills/loopwright-test/SKILL.md');
    const at = test.indexOf(PENDING);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(test.indexOf('spawn the `loopwright-tester` subagent'));
    const line = test.split('\n').find((l) => l.includes(PENDING));
    expect(line).toContain('/loopwright-review');
  });
});

describe('implementer on the approved-simplifications run', () => {
  const input = section(content('agents/implementer.md'), 'Input');

  it('applies the approved cuts in place of Step 3', () => {
    expect(input).toMatch(/approved simplifications[\s\S]*in place of Step 3/i);
  });

  it('adds no unit tests', () => {
    expect(input).toMatch(/approved simplifications[\s\S]*no unit tests/i);
  });

  it('skips its own simplify pass', () => {
    expect(input).toMatch(/approved simplifications[\s\S]*skip\w* Step 5/i);
  });
});
