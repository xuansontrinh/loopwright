import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

const TASK_MAIN = 'tasks/2026-11-13-main-task.md';
const TASK_WT = 'tasks/2026-11-13-wt-task.md';

/** A committed repo (main checkout, .loopwright/ without config) plus one linked worktree on branch `feat`. */
function repoWithWorktree(): { repo: string; wt: string } {
  const repo = makeRepo();
  const wt = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-wt-'))), 'wt');
  git(repo, ['worktree', 'add', '-q', '-b', 'feat', wt]);
  return { repo, wt };
}
const files = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);
const localDate = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

describe('per-worktree layout: start and dir', () => {
  it('start in a linked worktree scaffolds its own .loopwright without a config and writes state there', () => {
    const { repo, wt } = repoWithWorktree();
    const r = runLw(wt, ['start', TASK_WT]);
    expect(r.code, r.stderr).toBe(0);
    const lw = join(wt, '.loopwright');
    expect(readFileSync(join(lw, '.gitignore'), 'utf8')).toBe('*\n');
    expect(existsSync(join(lw, 'tasks'))).toBe(true);
    expect(existsSync(join(lw, 'state'))).toBe(true);
    expect(existsSync(join(lw, 'config.json'))).toBe(false);
    expect(files(join(lw, 'state'))).toHaveLength(1);
    expect(files(join(repo, '.loopwright/state'))).toEqual([]);
    expect(git(wt, ['status', '--porcelain'])).toBe('');
  });

  it('dir in a linked worktree prints that worktree .loopwright', () => {
    const { wt } = repoWithWorktree();
    expect(runLw(wt, ['start', TASK_WT]).code).toBe(0);
    expect(runLw(wt, ['dir']).stdout.trim()).toBe(join(wt, '.loopwright'));
  });
});

describe('per-worktree layout: independent tasks', () => {
  it('the main checkout and a linked worktree each start a task and each status prints its own', () => {
    const { repo, wt } = repoWithWorktree();
    const a = runLw(repo, ['start', TASK_MAIN]);
    expect(a.code, a.stderr).toBe(0);
    const b = runLw(wt, ['start', TASK_WT]);
    expect(b.code, b.stderr).toBe(0);
    expect(b.stderr).not.toContain('task already active');
    const sMain = JSON.parse(runLw(repo, ['status']).stdout);
    const sWt = JSON.parse(runLw(wt, ['status']).stdout);
    expect(sMain).toMatchObject({ task: TASK_MAIN, worktree: repo, branch: 'main' });
    expect(sWt).toMatchObject({ task: TASK_WT, worktree: wt, branch: 'feat' });
    expect(files(join(repo, '.loopwright/state'))).toHaveLength(1);
    expect(files(join(wt, '.loopwright/state'))).toHaveLength(1);
  });
});

describe('per-worktree layout: config and effort come from the main checkout', () => {
  it('config in a linked worktree prints the main checkout config.json as JSON', () => {
    const { repo, wt } = repoWithWorktree();
    const cfg = { maxFixRounds: 7, models: { claude: { reviewer: 'opus' } } };
    writeFileSync(join(repo, '.loopwright/config.json'), JSON.stringify(cfg));
    const r = runLw(wt, ['config']);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(cfg);
    expect(existsSync(join(wt, '.loopwright/config.json'))).toBe(false);
  });

  it('effort in a linked worktree uses the profile recorded in the main checkout manifest', () => {
    const { repo, wt } = repoWithWorktree();
    writeFileSync(
      join(repo, '.loopwright/manifest.json'),
      JSON.stringify({ files: {}, options: { hook: true, symlink: true, profile: 'thorough' } }),
    );
    expect(runLw(wt, ['effort', 'scout']).stdout.trim()).toBe('high');
    expect(runLw(wt, ['effort', 'reviewer']).stdout.trim()).toBe('xhigh');
    expect(runLw(wt, ['start', TASK_WT]).code).toBe(0);
    expect(runLw(wt, ['effort', 'tester']).stdout.trim()).toBe('high');
    expect(runLw(wt, ['effort', 'reviewer']).stdout.trim()).toBe('xhigh');
  });
});

describe('per-worktree layout: start refuses a task that belongs to another worktree', () => {
  const taskText = (header: string) => `# X\n\nkind: feature\nstatus: active\nstage: plan\n${header}\n\n## Goal\nx\n`;

  it('refuses a task file whose worktree header names a different worktree, writing no state', () => {
    const { repo, wt } = repoWithWorktree();
    writeFileSync(join(repo, '.loopwright/tasks/x.md'), taskText(`worktree: ${wt} (branch feat)`));
    const r = runLw(repo, ['start', 'tasks/x.md']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(wt);
    expect(files(join(repo, '.loopwright/state'))).toEqual([]);
    expect(files(join(wt, '.loopwright/state'))).toEqual([]);
    expect(runLw(repo, ['status']).code).toBe(1);
  });

  it('refuses the same way from a linked worktree whose task names the main checkout', () => {
    const { repo, wt } = repoWithWorktree();
    mkdirSync(join(wt, '.loopwright/tasks'), { recursive: true });
    writeFileSync(join(wt, '.loopwright/tasks/x.md'), taskText(`worktree: ${repo} (branch main)`));
    const r = runLw(wt, ['start', 'tasks/x.md']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(repo);
    expect(files(join(wt, '.loopwright/state'))).toEqual([]);
    expect(files(join(repo, '.loopwright/state'))).toEqual([]);
  });

  it('starts a task whose worktree header names this worktree', () => {
    const { repo, wt } = repoWithWorktree();
    writeFileSync(join(repo, '.loopwright/tasks/x.md'), taskText(`worktree: ${repo} (branch main)`));
    const r = runLw(repo, ['start', 'tasks/x.md']);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(runLw(repo, ['status']).stdout).task).toBe('tasks/x.md');
    expect(files(join(wt, '.loopwright/state'))).toEqual([]);
  });

  it('starts a task file that has no worktree header', () => {
    const { repo } = repoWithWorktree();
    writeFileSync(join(repo, '.loopwright/tasks/x.md'), taskText(''));
    expect(runLw(repo, ['start', 'tasks/x.md']).code).toBe(0);
  });
});

describe('per-worktree layout: park and explore write under the current worktree', () => {
  it('park in a linked worktree writes the stub under that worktree .loopwright', () => {
    const { repo, wt } = repoWithWorktree();
    const r = runLw(wt, ['park', 'Cache the thing']);
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.stub).toBe(`tasks/${localDate()}-Cache-the-thing.md`);
    const text = readFileSync(join(wt, '.loopwright', out.stub), 'utf8');
    expect(text).toContain('status: proposed');
    expect(files(join(repo, '.loopwright/tasks'))).toEqual([]);
  });

  it('park during a task in a linked worktree links the stub in that worktree task file', () => {
    const { repo, wt } = repoWithWorktree();
    expect(runLw(wt, ['start', TASK_WT]).code).toBe(0);
    writeFileSync(join(wt, '.loopwright', TASK_WT), '# Task\n\nstatus: active\n\n## Goal\nx\n');
    const r = runLw(wt, ['park', 'Cache the thing']);
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.foundWhile).toBe(TASK_WT);
    expect(existsSync(join(wt, '.loopwright', out.stub))).toBe(true);
    expect(readFileSync(join(wt, '.loopwright', TASK_WT), 'utf8')).toContain(out.stub);
    expect(files(join(repo, '.loopwright/tasks'))).toEqual([]);
  });

  it('explore in a linked worktree creates its run folder under that worktree .loopwright', () => {
    const { repo, wt } = repoWithWorktree();
    const r = runLw(wt, ['explore', '.']);
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.dir).toMatch(/^explore\//);
    expect(existsSync(join(wt, '.loopwright', out.dir, 'run.md'))).toBe(true);
    expect(existsSync(join(repo, '.loopwright/explore'))).toBe(false);
  });
});
