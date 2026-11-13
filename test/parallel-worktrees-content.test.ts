import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const skill = (name: string) => readFileSync(contentRoot() + `skills/loopwright-${name}/SKILL.md`, 'utf8');
const LW = 'node "{{LW_HOME}}/hooks/lw.mjs"';

describe('goal intake in flow, plan and fix', () => {
  for (const name of ['flow', 'plan', 'fix']) {
    describe(`loopwright-${name}`, () => {
      it('lists open tasks across worktrees with lw.mjs tasks', () => {
        expect(skill(name)).toContain(`${LW} tasks`);
      });

      it('never offers to close or shelve an unrelated task', () => {
        expect(skill(name)).toMatch(/never (offer to )?(close|shelve)[^\n]*unrelated/i);
      });

      it('offers a new worktree when this one is occupied and creates it with lw.mjs worktree', () => {
        const body = skill(name);
        expect(body).toMatch(/occupied/i);
        expect(body).toContain(`${LW} worktree`);
      });

      it('prints the start command for each tool', () => {
        const body = skill(name);
        expect(body).toContain('cd <path> && claude "/loopwright-flow"');
        expect(body).toContain("cd <path> && codex '$loopwright-flow'");
        expect(body).not.toContain('codex "$loopwright-flow"');
        expect(body).toMatch(/Junie[^\n]*cd <path>[^\n]*\/loopwright-flow/);
      });

      it('sends a related task in another worktree to its start command', () => {
        expect(skill(name)).toMatch(/related[^\n]*(another|other) worktree[^\n]*start command/i);
      });
    });
  }
});

describe('config is read through lw.mjs config', () => {
  for (const name of ['plan', 'review', 'done']) {
    it(`loopwright-${name} calls lw.mjs config and does not open <lw>/config.json`, () => {
      const body = skill(name);
      expect(body).toContain(`${LW} config`);
      expect(body).not.toContain('<lw>/config.json');
    });
  }
});

describe('done and park', () => {
  it('done offers lw.mjs carry for the proposed stubs of a linked worktree', () => {
    const body = skill('done');
    expect(body).toContain(`${LW} carry`);
    expect(body).toMatch(/main checkout/i);
  });

  it('park no longer says the stub is shared by all worktrees', () => {
    const body = skill('park');
    expect(body).not.toMatch(/shared by all worktrees/i);
    expect(body).toMatch(/new worktree|another worktree/i);
  });
});
