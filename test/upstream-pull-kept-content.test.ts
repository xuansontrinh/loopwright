import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const skill = readFileSync(contentRoot() + 'skills/loopwright-build/SKILL.md', 'utf8');
const upstreamStep = skill.split('\n').find((l) => l.startsWith('6. Upstream check'))!;

describe('loopwright-build upstream pull when the task already has commits of its own', () => {
  it('notes ownCommits before asking, then keeps the base with keep-base --pulled and tells the user', () => {
    expect(upstreamStep).toMatch(/Before asking, run `brief` and note whether `ownCommits` is present/);
    expect(upstreamStep).toMatch(
      /If the user pulled and `ownCommits` was present[^\n]*keep-base --pulled --reason[^\n]*instead of the restart below/,
    );
    expect(upstreamStep).toMatch(/If it pulled and `ownCommits` was absent, rebase the review scope/);
    expect(upstreamStep).toMatch(/tell the user the pulled commits stay in the review/);
  });

  it('puts the keep-base path before the base move', () => {
    expect(upstreamStep.indexOf('keep-base --pulled')).toBeGreaterThan(-1);
    expect(upstreamStep.indexOf('keep-base --pulled')).toBeLessThan(upstreamStep.indexOf('--force --base HEAD'));
  });
});
