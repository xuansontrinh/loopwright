import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');

describe.each(['build', 'review'])('loopwright-%s on a moved branch with an earlier kept answer', (name) => {
  const skill = read(`skills/loopwright-${name}/SKILL.md`);

  it('treats a pulled answer as the keep-base path with the both-kinds notice', () => {
    expect(skill).toMatch(/headMoved\.keptEarlier[^\n]*both kinds[^\n]*'pulled' answer takes the keep-base path/);
  });
});

describe('loopwright-test with pulledLocks', () => {
  it('leaves the slice markers alone', () => {
    expect(read('skills/loopwright-test/SKILL.md')).toMatch(/`pulledLocks`: leave the slice markers alone/);
  });
});
