import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const reviewer = readFileSync(join(contentRoot(), 'prompts/reviewer.md'), 'utf8');
const HEADING = '## Change review (round 2 or later)';
const section = (reviewer.split(HEADING)[1] ?? '').split('\n## ')[0]!;
const fix = reviewer.split('## Fix tasks')[1]!.split('\n## ')[0]!;

describe('change review in the reviewer procedure', () => {
  it('lets the reviewer run review-diff', () => {
    expect(reviewer).toContain(
      'Use only `status`, `check-locks`, `fingerprint` and, in a change review, `review-diff`',
    );
  });

  it('applies only when the caller asks, and sits before the fix-task rules', () => {
    expect(section).toContain('only when the caller says "Change review"');
    expect(reviewer.indexOf(HEADING)).toBeLessThan(reviewer.indexOf('## Fix tasks'));
  });

  it('keeps the locked-test check, limits the scope and confirms earlier findings', () => {
    expect(section).toMatch(/Section 0 \(locked tests\) runs first/);
    expect(section).toContain('lw.mjs" review-diff');
    expect(section).toMatch(/Do not review again/);
    expect(section).toMatch(/earlier Blocking finding[^\n]*fixed only in appearance[^\n]*Blocking/);
    expect(section).toMatch(/earlier Undecided finding[^\n]*Still applies[^\n]*Undecided/);
    expect(section).toMatch(/implementer report stays out/i);
  });

  it('never passes a change it could not read', () => {
    expect(section).toMatch(/cut off[^\n]*review-diff --stat/);
    expect(section).toMatch(/fails[^\n]*full blind pass/);
  });

  it('does not repeat the sibling search on a fix task', () => {
    expect(fix).toMatch(/change review[^\n]*sibling search is not repeated/i);
    expect(fix).toMatch(/change review[^\n]*changed lines/i);
  });
});
