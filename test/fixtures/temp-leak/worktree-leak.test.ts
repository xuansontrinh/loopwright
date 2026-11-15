import { describe, expect, it } from 'vitest';
import { makeRepo, runLw } from '../../hooks/helpers.js';

describe.skipIf(!process.env.LW_TEMP_CLEANUP_PROBE)('temp dir probe: worktree', () => {
  it('creates a sibling worktree next to the repo', () => {
    const repo = makeRepo();
    expect(runLw(repo, ['worktree', 'Fix login crash'], 'Login crashes.').code).toBe(0);
  });
});
