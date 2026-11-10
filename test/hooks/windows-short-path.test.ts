import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { git, isolatedEnv, runLw, scaffoldLoopwright } from './helpers.js';

const GUARD = resolve(__dirname, '../../content/hooks/guard-locked-tests.mjs');

// On Windows os.tmpdir() is an 8.3 short path (RUNNER~1) while git reports the long form.
describe.skipIf(process.platform !== 'win32')('AC2: short-form temp paths', () => {
  it('AC2: lw lock accepts a short-form path and the guard denies an edit through it', () => {
    const repo = mkdtempSync(join(tmpdir(), 'lw-short-')); // deliberately NOT realpath'd
    git(repo, ['init', '-q', '-b', 'main']);
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'init']);
    scaffoldLoopwright(repo);
    mkdirSync(join(repo, '.loopwright/tasks'), { recursive: true });
    writeFileSync(join(repo, '.loopwright/tasks/2026-11-08-x.md'), '# T\n\n## Goal\n\nx\n');
    expect(runLw(repo, ['start', 'tasks/2026-11-08-x.md']).code).toBe(0);
    expect(runLw(repo, ['stage', 'test']).code).toBe(0);
    mkdirSync(join(repo, 'test'));
    writeFileSync(join(repo, 'test/t.test.ts'), 'x');
    const lock = runLw(repo, ['lock', 'test/t.test.ts']);
    expect(lock.code, lock.stderr).toBe(0);
    expect(runLw(repo, ['stage', 'build']).code).toBe(0);

    const payload = JSON.stringify({
      cwd: repo,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(repo, 'test', 't.test.ts') },
    });
    const r = spawnSync('node', [GUARD, '--tool', 'claude'], {
      cwd: repo,
      input: payload,
      encoding: 'utf8',
      env: isolatedEnv(),
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('locked acceptance test');
  });
});
