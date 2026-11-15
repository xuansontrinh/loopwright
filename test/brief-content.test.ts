import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const skillsDir = join(contentRoot(), 'skills');
const skill = (name: string) => readFileSync(join(skillsDir, `loopwright-${name}`, 'SKILL.md'), 'utf8');
const allSkills = readdirSync(skillsDir).map((d) => ({
  name: d,
  text: readFileSync(join(skillsDir, d, 'SKILL.md'), 'utf8'),
}));
const setupOf = (name: string) => skill(name).split('## Setup')[1]!.split('\n## ')[0]!;

describe('stage skills read their state with one brief call', () => {
  it.each(['test', 'build', 'review', 'done'])('%s setup calls brief once and not dir, status or config', (stage) => {
    const setup = setupOf(stage);
    expect(setup.split('lw.mjs" brief').length - 1).toBe(1);
    expect(setup).not.toMatch(/lw\.mjs" (dir|status|config)\b/);
  });

  it.each([
    ['test', 'tester'],
    ['build', 'implementer'],
    ['review', 'reviewer'],
  ])('%s setup passes its own role to brief', (stage, role) => {
    expect(setupOf(stage)).toContain(`lw.mjs" brief ${role}`);
  });
});

describe('stage skills leave the task header stage to lw.mjs', () => {
  it.each(allSkills)('$name does not tell the agent to set the stage line by hand', ({ text }) => {
    expect(text).not.toMatch(/set `stage: [^`]*`/);
    expect(text).not.toContain('`stage: <plan|test>`');
    expect(text).not.toMatch(/for plan also `plan: draft`/);
  });

  it.each(['test', 'build', 'review', 'done'])(
    '%s tells the agent what to do when the header was not updated',
    (stage) => {
      expect(skill(stage)).toContain('"header": false');
    },
  );
});

describe('subagent spawns take effort from brief', () => {
  it('build, test and review no longer call the effort command for their spawn', () => {
    expect(skill('build')).not.toMatch(/lw\.mjs" effort implementer/);
    expect(skill('test')).not.toMatch(/lw\.mjs" effort tester/);
    const spawn = skill('review')
      .split('\n')
      .find((l) => l.includes('Blind pass.**'))!;
    expect(spawn).toContain('`effort`');
    expect(spawn).not.toMatch(/lw\.mjs" effort reviewer/);
  });

  it('build, test and review still fall back to spawning without effort', () => {
    for (const s of ['build', 'test', 'review']) expect(skill(s)).toMatch(/spawn rejects `effort`/);
  });
});
