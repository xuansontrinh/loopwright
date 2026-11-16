import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

describe.each(['build', 'review'])('loopwright-%s on a moved branch with local-only commits', (name) => {
  const skill = readFileSync(contentRoot() + `skills/loopwright-${name}/SKILL.md`, 'utf8');

  it('reads the both-kinds decision from headMoved.localOnly, not from the commit subjects', () => {
    expect(skill).toMatch(
      /headMoved\.localOnly[^\n]*both kinds[^\n]*'pulled' answer takes the keep-base path[^\n]*Never judge this from the commit subjects/,
    );
  });
});
