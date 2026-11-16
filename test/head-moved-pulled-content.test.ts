import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

describe.each(['build', 'review'])('loopwright-%s on a branch holding both kinds of commits', (name) => {
  const skill = readFileSync(contentRoot() + `skills/loopwright-${name}/SKILL.md`, 'utf8');

  it('adds --pulled to keep-base so the changed locked tests reach pulledLocks', () => {
    expect(skill).toMatch(/Both kinds: add `--pulled` to that command[^\n]*`pulledLocks`/);
  });
});
