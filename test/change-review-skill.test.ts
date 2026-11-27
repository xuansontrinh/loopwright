import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const review = readFileSync(join(contentRoot(), 'skills/loopwright-review/SKILL.md'), 'utf8');
const setup = review.split('## Setup')[1]!.split('## Simplify')[0]!;
const passes = review.split('## Passes')[1]!.split('## Outcome')[0]!;
const outcome = review.split('## Outcome')[1]!.split('## After a pass')[0]!;
const lineWith = (text: string, re: RegExp) => text.split('\n').find((l) => re.test(l)) ?? '';

describe('change reviews in the review skill', () => {
  it('reads the snapshot from brief', () => {
    expect(setup).toContain('`reviewed`');
  });

  it('runs a change review only from round 2, with a snapshot and the earlier findings at hand', () => {
    const rule = lineWith(passes, /\*\*Change review\.\*\*/);
    expect(rule).toMatch(/round `n` is 2 or more/);
    expect(rule).toMatch(/`reviewed`/);
    expect(rule).toMatch(/word for word/);
    expect(rule).toMatch(/otherwise[^.]*blind pass/i);
  });

  it('gives the reviewer the earlier findings and nothing else new', () => {
    expect(passes).toContain('Follow `{{LW_HOME}}/prompts/reviewer.md`. Change review.');
    expect(passes).toContain('Findings of the earlier round:');
    expect(passes).toContain('Sent to Build:');
    expect(passes).toContain('Undecided, not asked yet:');
    expect(passes).toMatch(/never[^.\n]*dismissed/i);
  });

  it('lets the headless reviewer run review-diff', () => {
    expect(passes).toContain(`'Bash(node "{{LW_HOME}}/hooks/lw.mjs" review-diff:*)'`);
    expect(passes).toContain('"Bash(node {{LW_HOME}}/hooks/lw.mjs review-diff:*)"');
  });

  it('tells the user and the log which rounds looked only at the changes', () => {
    expect(outcome).toMatch(/checked only what changed since the last review/);
    expect(outcome).toMatch(/plain words following the rules file/);
    expect(outcome).toContain('changes only');
  });

  it('writes sibling lines for every round of a fix task', () => {
    const line = lineWith(outcome, /records its merged `siblings`/);
    expect(line).toMatch(/every round/i);
    expect(line).toContain('- Sibling <path>:<line> — <why>');
  });

  it('reads brief again after the pulled-locks reopen, so a dropped snapshot is not used', () => {
    const step = lineWith(setup, /^8\. /);
    expect(step).toMatch(/run `brief reviewer` again[^.]*`reopen` drops `reviewed`/);
  });

  it('builds the headless prompt from a quoted heredoc, so quoted code in findings is not run', () => {
    const step = lineWith(passes, /^4\. \*\*Cross-agent pass/);
    expect(step).toContain(`PROMPT="$(cat <<'EOF'`);
    expect(step).toMatch(/never inside double quotes/);
    expect(step).not.toContain('PROMPT="Follow');
  });
});
