import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';
import { createTempGitRepo, runCli } from './helpers.js';

const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');
const skill = (name: string) => read(`skills/loopwright-${name}/SKILL.md`);
const section = (body: string, heading: RegExp) => {
  const parts = body.split(/^(?=## )/m);
  return parts.find((p) => heading.test(p.split('\n')[0]!)) ?? '';
};

describe('park skill', () => {
  it('exists with a spec-valid name and a real description', () => {
    expect(existsSync(contentRoot() + 'skills/loopwright-park/SKILL.md')).toBe(true);
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill('park'))![1]!;
    expect(fm).toMatch(/^name: loopwright-park$/m);
    const desc = /^description: (.*)$/m.exec(fm)![1]!;
    expect(desc.length).toBeGreaterThan(40);
    expect(desc).not.toContain(': ');
  });

  it('has the standard setup', () => {
    const setup = section(skill('park'), /^## Setup/);
    expect(setup).toContain('git rev-parse --show-toplevel');
    expect(setup).toContain('node "{{LW_HOME}}/hooks/lw.mjs" dir');
    expect(setup).toContain('`null` inside a git repo');
    expect(setup).toContain('creates `.loopwright/`');
    expect(setup).toContain('Not a git repo → tell the user loopwright must run inside a git repo');
  });

  it('parks through lw.mjs park without touching the current task or starting the new one', () => {
    const body = skill('park');
    expect(body).toContain('lw.mjs" park');
    expect(body).toContain('--blocks');
    expect(body).toMatch(/title/i);
    expect(body).toMatch(/path:line/);
    expect(body).toMatch(/Goal/);
    expect(body).toMatch(/Evidence/);
    expect(body).toMatch(
      /never (changes|change|edit)[^\n]*(current|active) task|do not (change|edit)[^\n]*(current|active) task/i,
    );
    expect(body).toMatch(/never start|do not start|not start/i);
    expect(body).toMatch(/no scouting|do not scout|never scout|without scouting/i);
    expect(body).toContain('do not spawn the subagents here');
  });

  it('asks one blocking question recommending no, and suggests another worktree when blocking', () => {
    const body = skill('park');
    expect(body).toMatch(/block/i);
    expect(body).toMatch(/recommend[^\n]*"?no"?/i);
    expect(body).toMatch(/new worktree/i);
  });

  it('pauses with await-user and resume only when the active task is in build or review', () => {
    const body = skill('park');
    expect(body).toContain('await-user');
    expect(body).toContain('resume');
    expect(body).toMatch(/build/i);
    expect(body).toMatch(/review/i);
  });
});

describe('done skill and parked follow-ups', () => {
  const done = () => skill('done');

  it('lists stubs whose found while names this task', () => {
    expect(done()).toMatch(/found while/);
    expect(done()).toMatch(/proposed/);
  });

  it('drafts issue text per stub, shown and never filed, without task paths or ids', () => {
    const body = done();
    expect(body).toMatch(/issue text/i);
    expect(body).toMatch(/never (file|filed|create)|do not file|not file/i);
    expect(body).toMatch(/no task paths|without task paths|task paths? (or|and) (task )?ids?/i);
  });

  it('adds a PR Follow-ups section for every kind', () => {
    const body = done();
    expect(body).toMatch(/Follow-ups/);
    expect(body).toMatch(/every kind|all kinds|any kind|for every task/i);
  });

  it('asks one question for a stub still blocking this task: clear the flag or note it in the PR', () => {
    const body = done();
    expect(body).toMatch(/blocking|blocks:/i);
    expect(body).toMatch(/clear[^\n]*(flag|blocks)/i);
    expect(body).toMatch(/note[^\n]*PR|PR[^\n]*note/i);
  });
});

describe('flow and plan pick up proposed stubs', () => {
  it('flow lists proposed stubs on resume and offers start, drop or a new task', () => {
    const body = skill('flow');
    expect(body).toMatch(/status: proposed/);
    expect(body).toMatch(/start/i);
    expect(body).toMatch(/drop/i);
    expect(body).toMatch(/new task/i);
  });

  it('flow names loopwright-park', () => {
    expect(skill('flow')).toContain('loopwright-park');
  });

  it('plan lists proposed stubs when invoked without a goal and offers start, drop or a new task', () => {
    const body = skill('plan');
    expect(body).toMatch(/status: proposed/);
    expect(body).toMatch(/without a goal|no goal/i);
    expect(body).toMatch(/drop/i);
    expect(body).toMatch(/new task/i);
  });

  it('plan fills a started stub in place, keeping found while, blocks and kind', () => {
    const body = skill('plan');
    expect(body).toMatch(/in place/i);
    expect(body).toMatch(/found while/);
    expect(body).toMatch(/blocks/);
    expect(body).toMatch(/imported spec/i);
  });
});

describe('park install', () => {
  it('init installs the park skill into a temp repo', () => {
    const repo = createTempGitRepo('lw-park-');
    const r = runCli(repo, ['init']);
    expect(r.exitCode, r.stderr).toBe(0);
    for (const base of ['.agents/skills', '.claude/skills']) {
      const p = join(repo, base, 'loopwright-park', 'SKILL.md');
      expect(existsSync(p), p).toBe(true);
      const text = readFileSync(p, 'utf8');
      expect(text).not.toContain('{{');
      expect(text).toContain('lw.mjs');
    }
  });
});
