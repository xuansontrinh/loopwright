import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

function setup(header: (repo: string, wt: string) => string) {
  const repo = makeRepo();
  const wt = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-wt-'))), 'wt');
  git(repo, ['worktree', 'add', '-q', '-b', 'feat', wt]);
  writeFileSync(
    join(repo, '.loopwright/tasks/t.md'),
    `# T\n\nkind: feature\nstatus: active\n${header(repo, wt)}\n\n## Goal\nG\n`,
  );
  return { repo, wt };
}

describe('adopt: refusals', () => {
  it('refuses in the main checkout with its own message', () => {
    const { repo } = setup((_r, wt) => `worktree: ${wt} (branch feat)`);
    const r = runLw(repo, ['adopt', 'tasks/t.md']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('adopt runs in the linked worktree');
  });

  it('refuses a task that names another worktree, writing nothing', () => {
    const { repo, wt } = setup((r) => `worktree: ${r} (branch main)`);
    const r = runLw(wt, ['adopt', 'tasks/t.md']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('belongs to the worktree');
    expect(existsSync(join(wt, '.loopwright'))).toBe(false);
    expect(existsSync(join(repo, '.loopwright/tasks/t.md'))).toBe(true);
  });

  it('copies a task with no state file and reports no state', () => {
    const { wt } = setup((_r, w) => `worktree: ${w} (branch feat)`);
    const r = runLw(wt, ['adopt', 'tasks/t.md']);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ task: 'tasks/t.md', state: false });
    mkdirSync(join(wt, '.loopwright/tasks'), { recursive: true });
    expect(runLw(wt, ['adopt', 'tasks/t.md']).code).toBe(1);
  });
});
