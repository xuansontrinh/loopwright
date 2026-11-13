import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempGitRepo, readJson, runCli } from './helpers.js';

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' });

describe('update in a new linked worktree', () => {
  it('installs the files there with the recorded options and leaves the main install settings alone', () => {
    const repo = createTempGitRepo();
    expect(runCli(repo, ['init', '--no-hook', '--profile', 'deep', '--experimental', 'junie-hooks']).exitCode).toBe(0);
    git(repo, ['commit', '--allow-empty', '-q', '-m', 'init']);
    const wt = join(dirname(repo), `${basename(repo)}-new`);
    git(repo, ['worktree', 'add', '-q', wt, '-b', 'new']);
    const manifestPath = join(repo, '.loopwright/manifest.json');
    const before = readFileSync(manifestPath, 'utf8');
    const effortLine = /^effort: xhigh$/m;

    const r = runCli(wt, ['update']);
    expect(r.exitCode, r.stderr).toBe(0);

    expect(existsSync(join(wt, '.agents/loopwright/hooks/lw.mjs'))).toBe(true);
    expect(readFileSync(join(wt, '.claude/agents/loopwright-implementer.md'), 'utf8')).toMatch(effortLine);
    // The declined hook wiring stays declined in the new worktree.
    expect(existsSync(join(wt, '.claude/settings.json'))).toBe(false);
    // One manifest, in the main checkout: its recorded options and contents are unchanged.
    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
    expect(readJson(manifestPath).options).toEqual({
      hook: false,
      symlink: true,
      experimental: ['junie-hooks'],
      profile: 'deep',
    });
    expect(readFileSync(join(repo, '.claude/agents/loopwright-implementer.md'), 'utf8')).toMatch(effortLine);
  });
});
