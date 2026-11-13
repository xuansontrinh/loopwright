import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const doc = (rel: string) => readFileSync(join(root, rel), 'utf8');
const sectionOf = (text: string, heading: RegExp) => {
  const parts = text.split(/^(?=#{2,3} )/m);
  return parts.find((p) => heading.test(p.split('\n')[0]!)) ?? '';
};

describe('installation doc', () => {
  const sec = () => sectionOf(doc('docs/installation.md'), /^#{2,3} Worktrees\b/);

  it('keeps tasks and state per worktree, with config and manifest in the main checkout', () => {
    const s = sec();
    expect(s).toMatch(/each worktree[^\n]*(tasks|\.loopwright)/i);
    expect(s).toMatch(/config\.json/);
    expect(s).toMatch(/manifest\.json/);
    expect(s).toMatch(/main (checkout|worktree)/i);
  });

  it('says deleting a worktree deletes its tasks', () => {
    expect(sec()).toMatch(
      /(delet|remov)\w*[^.\n]{0,40}worktree[^.\n]{0,80}(delet|remov|lose|lost|gone)\w*[^.\n]{0,40}tasks?/i,
    );
  });

  it('no longer says all worktrees share one .loopwright or that tasks survive removal', () => {
    const s = sec();
    expect(s).not.toMatch(/share one `\.loopwright\/`/);
    expect(s).not.toMatch(/survive removing/i);
  });
});

describe('workflow doc', () => {
  it('describes the handoff to a new worktree and session', () => {
    const w = doc('docs/workflow.md');
    expect(w).toContain('lw.mjs tasks');
    expect(w).toContain('lw.mjs worktree');
    expect(w).toContain('lw.mjs carry');
    expect(w).toMatch(/new session/i);
    expect(w).toContain('claude "/loopwright-flow"');
    expect(w).toMatch(/occupied/i);
  });
});

describe('enforcement doc', () => {
  it('states that the safety net cannot see a session that never changed directory', () => {
    const paras = doc('docs/enforcement.md').split(/\n{2,}/);
    const p = paras.find((x) => /\bcd\b/.test(x) && /worktree:/.test(x));
    expect(p).toBeDefined();
    expect(p).toMatch(/refus/i);
    expect(p).toMatch(/cannot|can't|does not|not /i);
  });
});

describe('CLAUDE.md', () => {
  it('says to start a new session in the worktree and drops the shared-state reason', () => {
    const c = doc('CLAUDE.md');
    expect(c).toMatch(/start a new session in the worktree/i);
    expect(c).not.toMatch(/task state lives in the main checkout's shared/i);
  });
});
