import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempGitRepo, runCli } from '../../helpers.js';
import { makeRepo, runLw } from '../../hooks/helpers.js';

describe.skipIf(!process.env.LW_TEMP_CLEANUP_PROBE)('temp dir probe: helpers', () => {
  it('creates temp dirs through every helper', () => {
    const repo = makeRepo();
    expect(runLw(repo, ['brief', 'tester']).code).toBeTypeOf('number');
    const git = createTempGitRepo('lw-h-');
    expect(runCli(git, ['--help']).exitCode).toBe(0);
    expect(mkdtempSync(join(tmpdir(), 'lw-direct-'))).toContain('lw-direct-');
  });
});
