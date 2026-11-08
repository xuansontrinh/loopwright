import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-08-x.md';

describe('lw.mjs', () => {
  it('start creates state for worktree', () => {
    const repo = makeRepo();
    const r = runLw(repo, ['start', TASK]);
    expect(r.code).toBe(0);
    const s = JSON.parse(runLw(repo, ['status']).stdout);
    expect(s).toMatchObject({ version: 1, task: TASK, stage: 'plan', worktree: repo, branch: 'main', lockedTests: [], verdict: null, stopBlocks: 0 });
    expect(s.baseCommit).toBe(git(repo, ['rev-parse', 'HEAD']));
  });

  it('resolves main worktree from secondary worktree', () => {
    const repo = makeRepo();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'lw-wt-'))), 'wt');
    git(repo, ['worktree', 'add', '-q', '-b', 'feat', wt]);
    expect(runLw(wt, ['start', TASK]).code).toBe(0);
    expect(runLw(repo, ['start', TASK]).code).toBe(0);
    const files = readdirSync(join(repo, '.loopwright', 'state'));
    expect(files).toHaveLength(2);
    expect(JSON.parse(runLw(wt, ['status']).stdout).branch).toBe('feat');
    expect(runLw(wt, ['dir']).stdout.trim()).toBe(join(repo, '.loopwright'));
  });

  it('lock then check-locks passes; edit then fails', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    mkdirSync(join(repo, 'test'));
    writeFileSync(join(repo, 'test/t.test.ts'), 'x');
    expect(runLw(repo, ['lock', 'test/t.test.ts', join(repo, 'a.txt')]).code).toBe(0);
    const ok = runLw(repo, ['check-locks']);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual({ ok: true, changed: [], missing: [] });
    writeFileSync(join(repo, 'test/t.test.ts'), 'y');
    const bad = runLw(repo, ['check-locks']);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stdout)).toEqual({ ok: false, changed: ['test/t.test.ts'], missing: [] });
  });

  it('check-locks reports missing', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['lock', 'a.txt']);
    git(repo, ['rm', '-q', '-f', 'a.txt']);
    const r = runLw(repo, ['check-locks']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).missing).toEqual(['a.txt']);
  });

  it('fingerprint changes on tracked edit and on new untracked file, not on ignored file', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, '.gitignore'), 'ignored.txt\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'ig']);
    runLw(repo, ['start', TASK]);
    const fp = () => JSON.parse(runLw(repo, ['fingerprint']).stdout).fingerprint as string;
    const f0 = fp();
    expect(fp()).toBe(f0);
    writeFileSync(join(repo, 'ignored.txt'), 'z');
    writeFileSync(join(repo, '.loopwright', 'tasks', 'n.md'), 'z');
    expect(fp()).toBe(f0);
    writeFileSync(join(repo, 'a.txt'), 'two\n');
    const f1 = fp();
    expect(f1).not.toBe(f0);
    writeFileSync(join(repo, 'new.txt'), 'n');
    expect(fp()).not.toBe(f1);
  });

  it('verdict records current fingerprint', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    const fp = JSON.parse(runLw(repo, ['fingerprint']).stdout).fingerprint;
    expect(runLw(repo, ['verdict', 'pass', '--round', '2']).code).toBe(0);
    expect(JSON.parse(runLw(repo, ['status']).stdout).verdict).toEqual({ pass: true, fingerprint: fp, round: 2 });
    expect(runLw(repo, ['verdict', 'fail']).code).toBe(1);
  });

  it('stage validates and resets stopBlocks; done clears active task', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    expect(runLw(repo, ['stage', 'bogus']).code).toBe(1);
    expect(runLw(repo, ['stage', 'build']).code).toBe(0);
    expect(JSON.parse(runLw(repo, ['status']).stdout).stage).toBe('build');
    expect(runLw(repo, ['done']).code).toBe(0);
    expect(readdirSync(join(repo, '.loopwright', 'state'))).toHaveLength(0);
    const r = runLw(repo, ['status']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('loopwright: no active task (run lw.mjs start <task-file>)');
  });

  it('corrupt state reads as null', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    const dir = join(repo, '.loopwright', 'state');
    const f = join(dir, readdirSync(dir)[0]);
    writeFileSync(f, '{nope');
    const r = runLw(repo, ['status']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('loopwright: ignoring corrupt state file');
    expect(r.stderr).toContain('no active task');
  });

  it('no-op outside git', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lw-nogit-')));
    const r = runLw(dir, ['dir']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('null');
    const s = runLw(dir, ['status']);
    expect(s.code).toBe(1);
    expect(s.stderr).toContain('loopwright: no .loopwright directory found');
  });
});
