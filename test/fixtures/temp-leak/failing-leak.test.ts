import { describe, expect, it } from 'vitest';
import { makeRepo, runLw } from '../../hooks/helpers.js';

describe.skipIf(!process.env.LW_TEMP_CLEANUP_PROBE)('temp dir probe: failing run', () => {
  it('fails after creating temp dirs', () => {
    const repo = makeRepo();
    runLw(repo, ['brief', 'tester']);
    expect(1).toBe(2);
  });
});
