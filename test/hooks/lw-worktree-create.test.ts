import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeBareRepo, makeRepo, runLw, scaffoldLoopwright } from './helpers.js';

const real = (p: string) => realpathSync.native(p);
const tasksOf = (wt: string) => {
  const d = join(wt, '.loopwright/tasks');
  return existsSync(d) ? readdirSync(d).sort() : [];
};
const sibling = (repo: string, slug: string) => join(dirname(repo), `${basename(repo)}-${slug}`);
const commitOn = (repo: string, file: string) => {
  writeFileSync(join(repo, file), 'x\n');
  git(repo, ['add', file]);
  git(repo, ['commit', '-q', '-m', file]);
  return git(repo, ['rev-parse', 'HEAD']);
};
const stubText = (title: string, goal: string, status = 'proposed') =>
  `# ${title}\n\nkind: feature\nstatus: ${status}\nstage: plan\nplan: draft\n\n## Goal\n${goal}\n\n## Evidence\n`;

/** Run `worktree` and parse its JSON; the new worktree's real path comes from the output. */
function create(cwd: string, title: string, goal = 'Goal text for the new task.', extra: string[] = []) {
  const r = runLw(cwd, ['worktree', title, ...extra], goal);
  expect(r.code, r.stderr).toBe(0);
  const out = JSON.parse(r.stdout);
  return { out, wt: real(out.worktree as string), r };
}

describe('worktree: creating a sibling worktree with a stub', () => {
  it('creates ../<repo-folder>-<slug> on a new branch <slug> and prints worktree, branch, base and stub', () => {
    const repo = makeRepo();
    const head = git(repo, ['rev-parse', 'HEAD']);
    const goal = 'Add a cache to the parser.\nKeep it small.';
    const { out, wt } = create(repo, 'cache the parser', goal);
    expect(wt).toBe(real(sibling(repo, 'cache-the-parser')));
    expect(out.branch).toBe('cache-the-parser');
    expect(typeof out.base).toBe('string');
    expect(out.base.length).toBeGreaterThan(0);
    expect(out.stub).toBeTruthy();
    expect(git(repo, ['worktree', 'list', '--porcelain'])).toContain('branch refs/heads/cache-the-parser');
    expect(git(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('cache-the-parser');
    expect(git(repo, ['rev-parse', 'cache-the-parser'])).toBe(head);
  });

  it('writes a proposed stub holding the goal into the new worktree tasks folder, not the main checkout', () => {
    const repo = makeRepo();
    const goal = 'Add a cache to the parser.\nKeep it small.';
    const { out, wt } = create(repo, 'cache the parser', goal);
    const names = tasksOf(wt);
    expect(names).toHaveLength(1);
    const text = readFileSync(join(wt, '.loopwright/tasks', names[0]), 'utf8');
    expect(text).toMatch(/^# cache the parser\s*$/m);
    expect(text).toMatch(/^status: proposed$/m);
    expect(text).toMatch(/^stage: plan$/m);
    expect(text).toMatch(/^## Goal\s*\n[\s\S]*Add a cache to the parser\.\s*\nKeep it small\./m);
    expect(text).toMatch(/^## Evidence/m);
    expect(text).not.toMatch(/^found while:/m);
    const stub = isAbsolute(out.stub) ? out.stub : join(wt, '.loopwright', out.stub);
    expect(real(stub)).toBe(real(join(wt, '.loopwright/tasks', names[0])));
    expect(tasksOf(repo)).toEqual([]);
    expect(readFileSync(join(wt, '.loopwright/.gitignore'), 'utf8')).toBe('*\n');
    expect(git(wt, ['status', '--porcelain'])).toBe('');
  });

  it('bases the branch on origin/HEAD when there is a remote, even if the local main is ahead', () => {
    const origin = makeBareRepo();
    const clone = join(real(mkdtempSync(join(tmpdir(), 'lw-clone-'))), 'clone');
    git(dirname(clone), ['clone', '-q', origin, clone]);
    scaffoldLoopwright(clone);
    const remoteTip = git(clone, ['rev-parse', 'origin/HEAD']);
    const localTip = commitOn(clone, 'ahead.txt');
    expect(localTip).not.toBe(remoteTip);
    const { wt } = create(clone, 'from remote');
    expect(git(wt, ['rev-parse', 'HEAD'])).toBe(remoteTip);
  });

  it('bases the branch on local main when there is no remote and HEAD is on another branch', () => {
    const repo = makeRepo();
    const mainTip = git(repo, ['rev-parse', 'main']);
    git(repo, ['checkout', '-q', '-b', 'dev']);
    commitOn(repo, 'dev.txt');
    const { wt } = create(repo, 'from main');
    expect(git(wt, ['rev-parse', 'HEAD'])).toBe(mainTip);
  });

  it('bases the branch on local master when main does not exist', () => {
    const repo = makeRepo();
    git(repo, ['branch', '-m', 'main', 'master']);
    const masterTip = git(repo, ['rev-parse', 'master']);
    git(repo, ['checkout', '-q', '-b', 'dev']);
    commitOn(repo, 'dev.txt');
    const { wt } = create(repo, 'from master');
    expect(git(wt, ['rev-parse', 'HEAD'])).toBe(masterTip);
  });

  it('falls back to HEAD when there is no remote, main or master', () => {
    const repo = makeRepo();
    git(repo, ['branch', '-m', 'main', 'trunk']);
    const tip = commitOn(repo, 'more.txt');
    const { wt } = create(repo, 'from head');
    expect(git(wt, ['rev-parse', 'HEAD'])).toBe(tip);
  });

  it('--base overrides the default base', () => {
    const repo = makeRepo();
    const first = git(repo, ['rev-parse', 'HEAD']);
    git(repo, ['tag', 'v1']);
    const second = commitOn(repo, 'second.txt');
    expect(second).not.toBe(first);
    const { out, wt } = create(repo, 'from tag', 'Goal.', ['--base', 'v1']);
    expect(git(wt, ['rev-parse', 'HEAD'])).toBe(first);
    expect([out.base].join('')).toMatch(new RegExp(`v1|${first}`));
  });

  it('fails without a title and creates nothing', () => {
    const repo = makeRepo();
    const before = git(repo, ['worktree', 'list']);
    const r = runLw(repo, ['worktree'], 'Goal.');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('worktree');
    expect(r.stderr).not.toContain('usage: lw.mjs <');
    expect(git(repo, ['worktree', 'list'])).toBe(before);
  });
});

describe('worktree: name collisions', () => {
  it('uses -2 and -3 when the folder and branch are taken, leaving the earlier worktrees untouched', () => {
    const repo = makeRepo();
    const a = create(repo, 'same name', 'First goal.');
    const b = create(repo, 'same name', 'Second goal.');
    const c = create(repo, 'same name', 'Third goal.');
    expect(a.wt).toBe(real(sibling(repo, 'same-name')));
    expect(b.wt).toBe(real(sibling(repo, 'same-name-2')));
    expect(c.wt).toBe(real(sibling(repo, 'same-name-3')));
    expect([a.out.branch, b.out.branch, c.out.branch]).toEqual(['same-name', 'same-name-2', 'same-name-3']);
    const read = (w: string) => readFileSync(join(w, '.loopwright/tasks', tasksOf(w)[0]), 'utf8');
    expect(read(a.wt)).toContain('First goal.');
    expect(read(b.wt)).toContain('Second goal.');
    expect(read(c.wt)).toContain('Third goal.');
  });

  it('does not overwrite a folder that already exists', () => {
    const repo = makeRepo();
    const taken = sibling(repo, 'busy-folder');
    mkdirSync(taken);
    writeFileSync(join(taken, 'keep.txt'), 'mine\n');
    const { out, wt } = create(repo, 'busy folder');
    expect(wt).toBe(real(sibling(repo, 'busy-folder-2')));
    expect(out.worktree).not.toBe(taken);
    expect(readFileSync(join(taken, 'keep.txt'), 'utf8')).toBe('mine\n');
    expect(readdirSync(taken)).toEqual(['keep.txt']);
  });

  it('does not reuse a branch name that already exists', () => {
    const repo = makeRepo();
    git(repo, ['branch', 'busy-branch']);
    const tip = git(repo, ['rev-parse', 'busy-branch']);
    const { out, wt } = create(repo, 'busy branch');
    expect(out.branch).toBe('busy-branch-2');
    expect(wt).toBe(real(sibling(repo, 'busy-branch-2')));
    expect(git(repo, ['rev-parse', 'busy-branch'])).toBe(tip);
    expect(git(repo, ['worktree', 'list', '--porcelain'])).not.toContain('branch refs/heads/busy-branch\n');
  });
});

describe('worktree --stub: starting an existing stub in a new worktree', () => {
  it('copies the stub into the new worktree and marks the source moved with the new path', () => {
    const repo = makeRepo();
    const rel = 'tasks/2026-11-13-parked-idea.md';
    const original = stubText('Parked idea', 'Do the parked idea properly.');
    writeFileSync(join(repo, '.loopwright', rel), original);
    const { wt } = create(repo, 'parked idea', 'ignored when a stub is given', ['--stub', rel]);
    const names = tasksOf(wt);
    expect(names).toHaveLength(1);
    const copy = readFileSync(join(wt, '.loopwright/tasks', names[0]), 'utf8');
    expect(copy).toContain('Do the parked idea properly.');
    expect(copy).toMatch(/^status: proposed$/m);
    const source = readFileSync(join(repo, '.loopwright', rel), 'utf8');
    expect(source).toMatch(/^status: moved\s*$/m);
    expect(source).not.toMatch(/^status: proposed\s*$/m);
    expect(source).toContain(join(wt, '.loopwright/tasks', names[0]));
    expect(source).toContain('Do the parked idea properly.');
  });

  it('works for a stub parked in a linked worktree', () => {
    const repo = makeRepo();
    const other = join(real(mkdtempSync(join(tmpdir(), 'lw-wt-'))), 'wt');
    git(repo, ['worktree', 'add', '-q', '-b', 'feat', other]);
    const parked = JSON.parse(runLw(other, ['park', 'Later work']).stdout).stub as string;
    const { wt } = create(other, 'later work', 'Goal.', ['--stub', parked]);
    expect(tasksOf(wt)).toHaveLength(1);
    expect(readFileSync(join(wt, '.loopwright/tasks', tasksOf(wt)[0]), 'utf8')).toMatch(/^status: proposed$/m);
    expect(readFileSync(join(other, '.loopwright', parked), 'utf8')).toMatch(/^status: moved\s*$/m);
  });

  it('fails with a missing stub file, creating no worktree', () => {
    const repo = makeRepo();
    const before = git(repo, ['worktree', 'list']);
    const r = runLw(repo, ['worktree', 'nothing here', '--stub', 'tasks/missing.md'], 'Goal.');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('missing.md');
    expect(git(repo, ['worktree', 'list'])).toBe(before);
    expect(existsSync(sibling(repo, 'nothing-here'))).toBe(false);
  });
});

describe('worktree: install detection', () => {
  const installHook = (dir: string) => {
    const hook = join(dir, '.agents/loopwright/hooks/lw.mjs');
    mkdirSync(dirname(hook), { recursive: true });
    writeFileSync(hook, '// installed\n');
  };

  it('flags installMissing when the current worktree has a repo-mode install the new one lacks', () => {
    const repo = makeRepo();
    installHook(repo); // untracked, so the new worktree does not get it
    const { out, wt } = create(repo, 'needs install');
    expect(existsSync(join(wt, '.agents/loopwright/hooks/lw.mjs'))).toBe(false);
    expect(out.installMissing).toBe(true);
  });

  it('does not flag installMissing when the install is committed and the new worktree has it', () => {
    const repo = makeRepo();
    installHook(repo);
    git(repo, ['add', '.agents']);
    git(repo, ['commit', '-q', '-m', 'install']);
    const { out, wt } = create(repo, 'has install');
    expect(existsSync(join(wt, '.agents/loopwright/hooks/lw.mjs'))).toBe(true);
    expect(out.installMissing).toBeFalsy();
  });

  it('does not flag installMissing when the current worktree has no repo-mode install', () => {
    const repo = makeRepo();
    const { out } = create(repo, 'no install anywhere');
    expect(out.installMissing).toBeFalsy();
  });
});

describe('carry: moving proposed stubs to the main checkout', () => {
  function linked() {
    const repo = makeRepo();
    const wt = join(real(mkdtempSync(join(tmpdir(), 'lw-wt-'))), 'wt');
    git(repo, ['worktree', 'add', '-q', '-b', 'feat', wt]);
    return { repo, wt };
  }
  const put = (wt: string, name: string, text: string) => {
    mkdirSync(join(wt, '.loopwright/tasks'), { recursive: true });
    writeFileSync(join(wt, '.loopwright/tasks', name), text);
  };

  it('copies proposed stubs to the main checkout and marks each source moved with the new path', () => {
    const { repo, wt } = linked();
    put(wt, 'one.md', stubText('One', 'First follow-up.'));
    put(wt, 'two.md', stubText('Two', 'Second follow-up.'));
    put(wt, 'active.md', stubText('Active', 'Still in progress.', 'active'));
    put(wt, 'done.md', stubText('Done', 'Finished.', 'done'));
    const r = runLw(wt, ['carry']);
    expect(r.code, r.stderr).toBe(0);
    expect(tasksOf(repo)).toEqual(['one.md', 'two.md']);
    expect(readFileSync(join(repo, '.loopwright/tasks/one.md'), 'utf8')).toContain('First follow-up.');
    expect(readFileSync(join(repo, '.loopwright/tasks/one.md'), 'utf8')).toMatch(/^status: proposed$/m);
    expect(readFileSync(join(repo, '.loopwright/tasks/two.md'), 'utf8')).toContain('Second follow-up.');
    for (const n of ['one.md', 'two.md']) {
      const src = readFileSync(join(wt, '.loopwright/tasks', n), 'utf8');
      expect(src).toMatch(/^status: moved\s*$/m);
      expect(src).toContain(join(repo, '.loopwright/tasks', n));
    }
    expect(readFileSync(join(wt, '.loopwright/tasks/active.md'), 'utf8')).toMatch(/^status: active$/m);
    expect(readFileSync(join(wt, '.loopwright/tasks/done.md'), 'utf8')).toMatch(/^status: done$/m);
  });

  it('adds a suffix on a name collision and keeps the main checkout file intact', () => {
    const { repo, wt } = linked();
    const existing = stubText('One', 'Already in main.');
    writeFileSync(join(repo, '.loopwright/tasks/one.md'), existing);
    put(wt, 'one.md', stubText('One', 'From the worktree.'));
    const r = runLw(wt, ['carry']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(repo, '.loopwright/tasks/one.md'), 'utf8')).toBe(existing);
    const extra = tasksOf(repo).filter((n) => n !== 'one.md');
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatch(/^one.+\.md$/);
    const copied = readFileSync(join(repo, '.loopwright/tasks', extra[0]), 'utf8');
    expect(copied).toContain('From the worktree.');
    const src = readFileSync(join(wt, '.loopwright/tasks/one.md'), 'utf8');
    expect(src).toMatch(/^status: moved\s*$/m);
    expect(src).toContain(join(repo, '.loopwright/tasks', extra[0]));
  });

  it('does not carry the same stub twice', () => {
    const { repo, wt } = linked();
    put(wt, 'one.md', stubText('One', 'First follow-up.'));
    expect(runLw(wt, ['carry']).code).toBe(0);
    runLw(wt, ['carry']);
    expect(tasksOf(repo)).toEqual(['one.md']);
  });

  it('fails in the main checkout with its own message and changes nothing', () => {
    const repo = makeRepo();
    const text = stubText('One', 'Parked in main.');
    writeFileSync(join(repo, '.loopwright/tasks/one.md'), text);
    const r = runLw(repo, ['carry']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('carry');
    expect(r.stderr).toMatch(/main checkout|linked worktree/);
    expect(r.stderr).not.toContain('usage: lw.mjs <');
    expect(tasksOf(repo)).toEqual(['one.md']);
    expect(readFileSync(join(repo, '.loopwright/tasks/one.md'), 'utf8')).toBe(text);
  });
});
