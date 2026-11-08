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
    runLw(repo, ['stage', 'test']);
    mkdirSync(join(repo, 'test'));
    writeFileSync(join(repo, 'test/t.test.ts'), 'x');
    expect(runLw(repo, ['lock', 'test/t.test.ts', join(repo, 'a.txt')]).code).toBe(0);
    const ok = runLw(repo, ['check-locks']);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual({ ok: true, changed: [], missing: [], lockedAfterBuild: [], forcedRestartAfterBuild: false });
    writeFileSync(join(repo, 'test/t.test.ts'), 'y');
    const bad = runLw(repo, ['check-locks']);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stdout)).toEqual({ ok: false, changed: ['test/t.test.ts'], missing: [], lockedAfterBuild: [], forcedRestartAfterBuild: false });
  });

  it('check-locks reports missing', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
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

  it('lock refused outside stage test', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'build']);
    const r = runLw(repo, ['lock', 'a.txt']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('loopwright: tests can only be locked in stage test');
  });

  it('start refused when active unless --force', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    const r = runLw(repo, ['start', TASK]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('loopwright: task already active (run lw.mjs done first, or start --force)');
    expect(runLw(repo, ['start', TASK, '--force']).code).toBe(0);
    const h = JSON.parse(runLw(repo, ['status']).stdout).history;
    expect(h.map((e: { event: string; detail: string }) => `${e.event}:${e.detail}`)).toEqual([`start:${TASK}`, 'stage:test', 'start:--force']);
  });

  it('start --force keeps history and locks: a modified locked test is not laundered', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    writeFileSync(join(repo, 'a.txt'), 'tampered\n');
    expect(runLw(repo, ['start', TASK, '--force']).code).toBe(0);
    const s = JSON.parse(runLw(repo, ['status']).stdout);
    expect(s.lockedTests.map((l: { path: string }) => l.path)).toEqual(['a.txt']);
    expect(s.stage).toBe('plan');
    // Without re-locking, the edit is visible.
    runLw(repo, ['stage', 'build']);
    const plain = runLw(repo, ['check-locks']);
    expect(plain.code).toBe(1);
    expect(JSON.parse(plain.stdout)).toMatchObject({ ok: false, changed: ['a.txt'], forcedRestartAfterBuild: true });
    // Re-locking the edited file is still flagged.
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    const r = JSON.parse(runLw(repo, ['check-locks']).stdout);
    expect(r.forcedRestartAfterBuild).toBe(true);
    expect(r.lockedAfterBuild).toEqual(['a.txt']);
  });

  it('forcedRestartAfterBuild is false for a --force restart before any build', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['start', TASK, '--force']);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    expect(JSON.parse(runLw(repo, ['check-locks']).stdout)).toEqual({ ok: true, changed: [], missing: [], lockedAfterBuild: [], forcedRestartAfterBuild: false });
  });

  it('a new path locked in a later slice is not in lockedAfterBuild; history is ordered', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['stage', 'review']);
    runLw(repo, ['stage', 'test']);
    writeFileSync(join(repo, 'b.txt'), 'b');
    expect(runLw(repo, ['lock', 'b.txt']).code).toBe(0);
    const r = runLw(repo, ['check-locks']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).lockedAfterBuild).toEqual([]);
    const h = JSON.parse(runLw(repo, ['status']).stdout).history;
    expect(h.map((e: { event: string; detail: string }) => `${e.event}:${e.detail}`)).toEqual([
      `start:${TASK}`, 'stage:test', 'lock:a.txt', 'stage:build', 'stage:review', 'stage:test', 'lock:b.txt',
    ]);
  });

  it('a path re-locked after a build is in lockedAfterBuild', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['stage', 'test']);
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    expect(runLw(repo, ['lock', 'a.txt']).code).toBe(0);
    expect(JSON.parse(runLw(repo, ['check-locks']).stdout).lockedAfterBuild).toEqual(['a.txt']);
  });

  it('a path locked twice within one test stage is not in lockedAfterBuild', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    expect(JSON.parse(runLw(repo, ['check-locks']).stdout).lockedAfterBuild).toEqual([]);
  });

  it('await-user sets awaitingUser; resume, stage and verdict clear it; history records them', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'build']);
    const status = () => JSON.parse(runLw(repo, ['status']).stdout);
    expect(runLw(repo, ['await-user']).code).toBe(1);
    expect(runLw(repo, ['await-user', 'deviation D2']).code).toBe(0);
    expect(status().awaitingUser).toBe('deviation D2');
    expect(runLw(repo, ['resume']).code).toBe(0);
    expect(status().awaitingUser).toBeUndefined();
    runLw(repo, ['await-user', 'undecided U1']);
    runLw(repo, ['stage', 'review']);
    expect(status().awaitingUser).toBeUndefined();
    runLw(repo, ['await-user', 'fix-round cap']);
    runLw(repo, ['verdict', 'fail', '--round', '1']);
    expect(status().awaitingUser).toBeUndefined();
    const h = status().history.map((e: { event: string; detail: string }) => `${e.event}:${e.detail}`);
    expect(h).toEqual(expect.arrayContaining(['await-user:deviation D2', 'resume:deviation D2', 'await-user:undecided U1', 'await-user:fix-round cap']));
  });

  it('fingerprint ignores diff.external/diff.relative and cwd', () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'sub'));
    writeFileSync(join(repo, 'sub/s.txt'), 's');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'sub']);
    git(repo, ['config', 'diff.external', 'true']);
    git(repo, ['config', 'diff.relative', 'true']);
    runLw(repo, ['start', TASK]);
    const sub = join(repo, 'sub');
    const fp = (cwd: string) => JSON.parse(runLw(cwd, ['fingerprint']).stdout).fingerprint as string;
    const before = fp(sub);
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    const after = fp(sub);
    expect(after).not.toBe(before);
    expect(fp(repo)).toBe(after);
  });
});
