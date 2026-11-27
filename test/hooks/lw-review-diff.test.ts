import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LW, git, isolatedEnv, makeRepo, runLw, scaffoldLoopwright } from './helpers.js';

const TASK = 'tasks/t.md';
const HEADER = '# T\n\nstatus: active\nstage: plan\n\n## Goal\n\nx\n';

function started(repo = makeRepo()): string {
  writeFileSync(join(repo, '.loopwright', TASK), HEADER);
  expect(runLw(repo, ['start', TASK]).code).toBe(0);
  return repo;
}
const verdict = (repo: string, round = 1) => runLw(repo, ['verdict', 'fail', '--round', String(round)]);
const diff = (repo: string, ...args: string[]) => runLw(repo, ['review-diff', ...args]);
const brief = (repo: string) => JSON.parse(runLw(repo, ['brief']).stdout);
const stateFile = (repo: string) => {
  const dir = join(repo, '.loopwright', 'state');
  return join(dir, readdirSync(dir)[0]!);
};
// Untrimmed git output: the `git` helper trims, which would cut the leading space of a ` M` status line.
const rawGit = (repo: string, args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout;
const lines = (text: string) => text.split('\n').filter(Boolean).sort();

function expectNoSnapshot(repo: string) {
  expect(brief(repo).reviewed).toBeUndefined();
  const r = diff(repo);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain('loopwright: no reviewed snapshot; run a full review');
}

describe('lw.mjs review-diff', () => {
  it('shows an edited file, a new file and a deleted file, and leaves an untouched file out', () => {
    const repo = started();
    writeFileSync(join(repo, 'gone.txt'), 'this file is removed after the review\n');
    writeFileSync(join(repo, 'keep.txt'), 'keep\n');
    expect(verdict(repo).code).toBe(0);
    writeFileSync(join(repo, 'a.txt'), 'two\n');
    writeFileSync(join(repo, 'new.txt'), 'a brand new file, nothing like the removed one\n');
    rmSync(join(repo, 'gone.txt'));
    const r = diff(repo);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('+two');
    expect(r.stdout).toContain('new.txt');
    expect(r.stdout).toContain('new file mode');
    expect(r.stdout).toContain('gone.txt');
    expect(r.stdout).toContain('deleted file mode');
    expect(r.stdout).not.toContain('keep.txt');
  });

  it('prints nothing when nothing changed since the verdict', () => {
    const repo = started();
    expect(verdict(repo).code).toBe(0);
    const r = diff(repo);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('prints a non-ASCII path unquoted', () => {
    const repo = started();
    expect(verdict(repo).code).toBe(0);
    writeFileSync(join(repo, 'tést.txt'), 'x\n');
    const r = diff(repo);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('tést.txt');
    expect(r.stdout).not.toContain('\\303');
  });

  it('fails with its own message and leaves the state alone when no verdict was recorded', () => {
    const repo = started();
    const before = readFileSync(stateFile(repo));
    const r = diff(repo);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no reviewed snapshot');
    expect(r.stdout).toBe('');
    expect(readFileSync(stateFile(repo)).equals(before)).toBe(true);
  });

  it('records the snapshot with its round, and brief reports the round', () => {
    const repo = started();
    expect(verdict(repo, 2).code).toBe(0);
    expect(JSON.parse(runLw(repo, ['status']).stdout).reviewed).toEqual({
      tree: expect.stringMatching(/^[0-9a-f]{40}$/),
      round: 2,
    });
    expect(brief(repo).reviewed).toEqual({ round: 2 });
    expect(runLw(repo, ['verdict', 'pass', '--round', '3']).code).toBe(0);
    expect(JSON.parse(runLw(repo, ['status']).stdout).reviewed).toEqual({
      tree: expect.stringMatching(/^[0-9a-f]{40}$/),
      round: 3,
    });
    expect(brief(repo).reviewed).toEqual({ round: 3 });
  });

  it('a restart and a reopen drop the snapshot', () => {
    const restarted = started();
    expect(verdict(restarted).code).toBe(0);
    expect(runLw(restarted, ['start', TASK, '--force']).code).toBe(0);
    expectNoSnapshot(restarted);

    const reopened = started();
    expect(runLw(reopened, ['stage', 'build']).code).toBe(0);
    expect(verdict(reopened).code).toBe(0);
    expect(runLw(reopened, ['reopen', 'test', 'why']).code).toBe(0);
    expectNoSnapshot(reopened);
  });

  it("neither the verdict nor review-diff changes git status or the user's index", () => {
    const repo = started();
    writeFileSync(join(repo, 'staged.txt'), 'staged\n');
    git(repo, ['add', 'staged.txt']);
    writeFileSync(join(repo, 'loose.txt'), 'loose\n');
    const status = rawGit(repo, ['status', '--porcelain']);
    const cached = rawGit(repo, ['diff', '--cached', '--name-only']);
    expect(verdict(repo).code).toBe(0);
    writeFileSync(join(repo, 'a.txt'), 'two\n');
    expect(diff(repo).code).toBe(0);
    expect(lines(rawGit(repo, ['status', '--porcelain']))).toEqual(lines(status + ' M a.txt\n'));
    expect(rawGit(repo, ['diff', '--cached', '--name-only'])).toBe(cached);
  });

  it('--stat lists the changed files and a path limits the diff', () => {
    const repo = started();
    expect(verdict(repo).code).toBe(0);
    writeFileSync(join(repo, 'a.txt'), 'two\n');
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    const stat = diff(repo, '--stat');
    expect(stat.code).toBe(0);
    expect(stat.stdout).toContain('a.txt');
    expect(stat.stdout).toContain('b.txt');
    expect(stat.stdout).not.toMatch(/^@@/m);
    const limited = diff(repo, 'b.txt');
    expect(limited.code).toBe(0);
    expect(limited.stdout).toContain('b.txt');
    expect(limited.stdout).not.toContain('a/a.txt');
  });

  it('--stat prints a path longer than 80 characters in full', () => {
    const repo = started();
    expect(verdict(repo).code).toBe(0);
    const folder = 'a-folder-with-a-rather-long-name-for-this-test';
    const long = `${folder}/and-a-file-whose-name-is-long-enough-too.txt`;
    expect(long.length).toBeGreaterThan(80);
    mkdirSync(join(repo, folder));
    writeFileSync(join(repo, long), 'x\n');
    const r = diff(repo, '--stat');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(long);
  });

  it('works from a subfolder of the worktree', () => {
    const repo = started();
    expect(verdict(repo).code).toBe(0);
    mkdirSync(join(repo, 'sub'));
    writeFileSync(join(repo, 'a.txt'), 'two\n');
    const r = runLw(join(repo, 'sub'), ['review-diff']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('a.txt');
  });

  it('treats a snapshot whose git object is gone as no snapshot', () => {
    const repo = started();
    expect(verdict(repo).code).toBe(0);
    const file = stateFile(repo);
    const state = JSON.parse(readFileSync(file, 'utf8'));
    state.reviewed.tree = '0'.repeat(40);
    writeFileSync(file, JSON.stringify(state));
    expectNoSnapshot(repo);
  });

  it('works in a linked worktree', () => {
    const repo = makeRepo();
    const wt = join(dirname(repo), basename(repo) + '-wt');
    git(repo, ['worktree', 'add', '-q', wt, '-b', 'feat']);
    scaffoldLoopwright(wt);
    started(wt);
    expect(verdict(wt).code).toBe(0);
    writeFileSync(join(wt, 'a.txt'), 'two\n');
    const r = diff(wt);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('a.txt');
  });

  it('prints a change larger than 1 MB in full', () => {
    const repo = started();
    expect(verdict(repo).code).toBe(0);
    writeFileSync(join(repo, 'big.txt'), `${'x'.repeat(40)}\n`.repeat(60_000));
    const r = spawnSync('node', [LW, 'review-diff'], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: isolatedEnv(),
    });
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(2_000_000);
  });

  it('still records the verdict and warns when the snapshot cannot be written', () => {
    const repo = started();
    const missing = join(repo, 'no-such-dir');
    const r = runLw(repo, ['verdict', 'fail', '--round', '1'], undefined, {
      TMPDIR: missing,
      TEMP: missing,
      TMP: missing,
    });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('reviewed snapshot not recorded');
    const b = brief(repo);
    expect(b.verdict.pass).toBe(false);
    expect(b.reviewed).toBeUndefined();
  });
});
