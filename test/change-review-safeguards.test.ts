import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const read = (p: string) => readFileSync(join(contentRoot(), p), 'utf8');
const review = read('skills/loopwright-review/SKILL.md');
const changeReview = review.split('**Change review.**')[1]!.split('\n3. ')[0]!;
const reviewer = read('prompts/reviewer.md');
const fix = reviewer.split('## Fix tasks')[1]!.split('\n## ')[0]!;
const precompact = read('hooks/precompact-instructions.mjs');

describe('change review safeguards', () => {
  it('never sends "none" to Build after a failed verdict and falls back to the blind pass', () => {
    expect(changeReview).toContain('`verdict.pass` is false in `brief`');
    expect(changeReview).toContain('"Sent to Build:" is never "none"');
    expect(changeReview).toContain('not at hand word for word, run the blind pass');
    expect(changeReview).toContain('only after a passing verdict');
  });

  it('asks compaction to keep the last round findings word for word until the next verdict', () => {
    expect(precompact).toContain('findings sent to Build');
    expect(precompact).toContain('undecided findings not yet asked');
    expect(precompact).toContain('until the next verdict');
  });

  it('checks the fix root-cause rule against the base diff, not the change-review diff', () => {
    expect(fix).toContain('the diff against the base commit');
    expect(fix).toContain('in a change review this was checked in an earlier round and is not checked again');
  });
});
