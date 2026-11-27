import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const skill = (name: string) => readFileSync(join(contentRoot(), 'skills', `loopwright-${name}`, 'SKILL.md'), 'utf8');
const doc = (name: string) => readFileSync(join(__dirname, '..', 'docs', name), 'utf8');
const planConfirm = skill('plan').split('## 7. Confirm')[1]!.split('## Fix tasks')[0]!;
const reviewAfterPass = skill('review').split('## After a pass')[1]!;
// https://code.claude.com/docs/en/cli-reference
const COMMAND = 'claude --model sonnet "/loopwright-flow"';

describe('cheaper model for the main thread after Plan', () => {
  it('is offered where a fresh context is taken, in both skills', () => {
    for (const s of [planConfirm, reviewAfterPass]) {
      expect(s).toContain(COMMAND);
      expect(s).toMatch(/cheaper model/);
      expect(s).toMatch(/subagents keep their configured models/);
      expect(s).toMatch(/`inherit`[^\n]*session model/);
      expect(s).toContain('`/clear`, then `/loopwright-flow`');
    }
  });

  it('is explained in the workflow docs and checked in the dogfood list', () => {
    const fresh = doc('workflow.md').split('## Taking a fresh context at a safe point')[1]!.split('\n## ')[0]!;
    expect(fresh).toContain(COMMAND);
    expect(fresh).toMatch(/`inherit`/);
    expect(fresh).toMatch(/`\/model`/);
    expect(doc('dogfood-checklist.md')).toContain(COMMAND);
  });
});
