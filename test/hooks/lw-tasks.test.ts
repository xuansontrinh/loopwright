import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeRepo, runLw } from './helpers.js';

/** A committed repo (main checkout) plus one linked worktree on branch `feat`. */
function repoWithWorktree(branch = 'feat'): { repo: string; wt: string } {
  const repo = makeRepo();
  return { repo, wt: addWorktree(repo, branch) };
}
function addWorktree(repo: string, branch: string): string {
  const wt = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-wt-'))), 'wt');
  git(repo, ['worktree', 'add', '-q', '-b', branch, wt]);
  return wt;
}
const files = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);
const stateId = (worktreePath: string) => createHash('sha256').update(worktreePath).digest('hex').slice(0, 12);

function taskText(o: {
  title: string;
  status: string;
  stage?: string;
  worktree: string;
  branch: string;
  goal?: string;
}) {
  return [
    `# ${o.title}`,
    '',
    'kind: feature',
    `status: ${o.status}`,
    `stage: ${o.stage ?? 'plan'}`,
    'plan: confirmed',
    `worktree: ${o.worktree} (branch ${o.branch})`,
    '',
    '## Goal',
    o.goal ?? `Goal of ${o.title}`,
    '',
    '## Evidence',
    '- none',
    '',
  ].join('\n');
}
function writeTask(root: string, name: string, text: string) {
  mkdirSync(join(root, '.loopwright/tasks'), { recursive: true });
  // As the scaffold does: keep .loopwright untracked-and-ignored so seeding it leaves `git status` clean.
  const ignore = join(root, '.loopwright/.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  writeFileSync(join(root, '.loopwright/tasks', name), text);
}

/** Every object nested anywhere in the JSON, with the keys leading to it (the listing's exact shape is the implementer's). */
type Node = { obj: Record<string, unknown>; path: string };
function nodes(v: unknown, path: string[] = [], acc: Node[] = []): Node[] {
  if (Array.isArray(v)) v.forEach((x, i) => nodes(x, [...path, String(i)], acc));
  else if (v && typeof v === 'object') {
    acc.push({ obj: v as Record<string, unknown>, path: path.join('/') });
    for (const [k, x] of Object.entries(v)) nodes(x, [...path, k], acc);
  }
  return acc;
}
const isProposedList = (n: Node) => /propos/i.test(n.path);
const forTask = (all: Node[], worktree: string, file: string) =>
  all.filter((n) => n.obj.worktree === worktree && typeof n.obj.task === 'string' && n.obj.task.endsWith(file));
const describeNode = (n: Node) => `${n.path} ${JSON.stringify(n.obj)}`;

function listTasks(cwd: string) {
  const r = runLw(cwd, ['tasks']);
  expect(r.code, r.stderr).toBe(0);
  const json = JSON.parse(r.stdout);
  return { json, text: r.stdout, all: nodes(json) };
}

describe('tasks: open-task listing across worktrees', () => {
  function seed() {
    const { repo, wt } = repoWithWorktree();
    const idle = addWorktree(repo, 'idle'); // linked worktree with no .loopwright/ at all
    writeTask(
      repo,
      'main-open.md',
      taskText({
        title: 'Main open task',
        status: 'active',
        stage: 'build',
        worktree: repo,
        branch: 'main',
        goal: 'Main goal text',
      }),
    );
    writeTask(
      repo,
      'main-stub.md',
      taskText({ title: 'Main parked stub', status: 'proposed', worktree: repo, branch: 'main' }),
    );
    for (const s of ['done', 'stopped', 'moved', 'dropped'])
      writeTask(
        repo,
        `main-${s}-one.md`,
        taskText({
          title: `Main ${s} one`,
          status: s,
          stage: s === 'done' ? 'done' : 'build',
          worktree: repo,
          branch: 'main',
        }),
      );
    writeTask(
      wt,
      'wt-open.md',
      taskText({
        title: 'Worktree open task',
        status: 'active',
        stage: 'test',
        worktree: wt,
        branch: 'feat',
        goal: 'Worktree goal text',
      }),
    );
    writeTask(
      wt,
      'wt-stub.md',
      taskText({ title: 'Worktree parked stub', status: 'proposed', worktree: wt, branch: 'feat' }),
    );
    for (const s of ['done', 'stopped', 'moved', 'dropped'])
      writeTask(
        wt,
        `wt-${s}-two.md`,
        taskText({ title: `Worktree ${s} two`, status: s, stage: 'build', worktree: wt, branch: 'feat' }),
      );
    return { repo, wt, idle };
  }

  it('lists every worktree in-progress task with worktree, branch, task, title, stage, goal and current', () => {
    const { repo, wt } = seed();
    const { all } = listTasks(wt);
    const main = forTask(all, repo, 'main-open.md').filter((n) => !isProposedList(n));
    const mine = forTask(all, wt, 'wt-open.md').filter((n) => !isProposedList(n));
    expect(main, 'main checkout task listed').toHaveLength(1);
    expect(mine, 'linked worktree task listed').toHaveLength(1);
    expect(main[0].obj).toMatchObject({
      worktree: repo,
      branch: 'main',
      title: 'Main open task',
      stage: 'build',
      current: false,
    });
    expect(String(main[0].obj.goal)).toContain('Main goal text');
    expect(mine[0].obj).toMatchObject({
      worktree: wt,
      branch: 'feat',
      title: 'Worktree open task',
      stage: 'test',
      current: true,
    });
    expect(String(mine[0].obj.goal)).toContain('Worktree goal text');
  });

  it('marks as current the worktree it runs in, from the main checkout too', () => {
    const { repo, wt } = seed();
    const { all } = listTasks(repo);
    expect(forTask(all, repo, 'main-open.md').find((n) => !isProposedList(n))?.obj.current).toBe(true);
    expect(forTask(all, wt, 'wt-open.md').find((n) => !isProposedList(n))?.obj.current).toBe(false);
  });

  it('lists status proposed stubs separately from in-progress tasks', () => {
    const { repo, wt } = seed();
    const { all } = listTasks(repo);
    for (const [root, file, title] of [
      [repo, 'main-stub.md', 'Main parked stub'],
      [wt, 'wt-stub.md', 'Worktree parked stub'],
    ]) {
      const hits = forTask(all, root, file);
      expect(hits, `${file} listed once`).toHaveLength(1);
      expect(hits[0].obj.title).toBe(title);
      expect(isProposedList(hits[0]), `${file} sits in its own proposed list (${describeNode(hits[0])})`).toBe(true);
    }
    // And the in-progress tasks are not in that list.
    for (const [root, file] of [
      [repo, 'main-open.md'],
      [wt, 'wt-open.md'],
    ]) {
      expect(forTask(all, root, file).every((n) => !isProposedList(n))).toBe(true);
    }
  });

  it('omits tasks whose status is done, stopped, moved or dropped', () => {
    const { wt } = seed();
    const { text } = listTasks(wt);
    for (const s of ['done', 'stopped', 'moved', 'dropped']) {
      expect(text).not.toContain(`main-${s}-one.md`);
      expect(text).not.toContain(`wt-${s}-two.md`);
    }
  });

  it('is read-only: it creates no .loopwright, state or task files', () => {
    const { repo, wt, idle } = seed();
    const before = [
      files(join(repo, '.loopwright/state')),
      files(join(repo, '.loopwright/tasks')),
      files(join(wt, '.loopwright/tasks')),
    ];
    listTasks(wt);
    listTasks(idle);
    expect(existsSync(join(idle, '.loopwright'))).toBe(false);
    expect([
      files(join(repo, '.loopwright/state')),
      files(join(repo, '.loopwright/tasks')),
      files(join(wt, '.loopwright/tasks')),
    ]).toEqual(before);
    expect(git(wt, ['status', '--porcelain'])).toBe('');
  });

  it('prints an empty listing, not an error, when nothing is open', () => {
    const { repo, wt } = repoWithWorktree();
    const { all } = listTasks(wt);
    expect(all.filter((n) => typeof n.obj.task === 'string')).toEqual([]);
    expect(existsSync(join(repo, '.loopwright/state'))).toBe(true);
  });
});

describe('tasks: unreadable worktrees', () => {
  it('reports a registered worktree whose folder is missing as unreadable, and still lists the others', () => {
    const { repo, wt } = repoWithWorktree();
    const gone = addWorktree(repo, 'vanished');
    writeTask(
      repo,
      'main-open.md',
      taskText({ title: 'Main open task', status: 'active', stage: 'build', worktree: repo, branch: 'main' }),
    );
    rmSync(gone, { recursive: true, force: true });
    const { all } = listTasks(wt);
    const hits = all.filter((n) => n.obj.worktree === gone);
    expect(hits, 'the missing worktree is not omitted').not.toHaveLength(0);
    expect(hits.some((n) => /unreadable/i.test(describeNode(n)))).toBe(true);
    expect(forTask(all, repo, 'main-open.md')).toHaveLength(1);
  });
});

describe('tasks: older-layout entries in the main checkout', () => {
  it('lists a main-checkout task file whose worktree header names a live linked worktree as older layout under that worktree', () => {
    const { repo, wt } = repoWithWorktree();
    writeTask(
      repo,
      'old-wt-task.md',
      taskText({
        title: 'Older layout task',
        status: 'active',
        stage: 'build',
        worktree: wt,
        branch: 'feat',
        goal: 'Older goal text',
      }),
    );
    for (const from of [repo, wt]) {
      const { all } = listTasks(from);
      const hits = forTask(all, wt, 'old-wt-task.md');
      expect(hits, `listed under the linked worktree (run from ${from})`).not.toHaveLength(0);
      expect(hits.some((n) => /older[ _-]?layout/i.test(describeNode(n)))).toBe(true);
      expect(forTask(all, repo, 'old-wt-task.md'), 'not listed as the main checkout own task').toEqual([]);
    }
  });

  it('does not call a main-checkout task that names the main checkout older layout', () => {
    const { repo, wt } = repoWithWorktree();
    writeTask(
      repo,
      'own.md',
      taskText({ title: 'Own task', status: 'active', stage: 'plan', worktree: repo, branch: 'main' }),
    );
    const { all } = listTasks(wt);
    const hits = forTask(all, repo, 'own.md');
    expect(hits).toHaveLength(1);
    expect(describeNode(hits[0])).not.toMatch(/older[ _-]?layout|worktree[ _-]?gone/i);
  });

  function goneState(repo: string, gone: string, task: string) {
    mkdirSync(join(repo, '.loopwright/state'), { recursive: true });
    writeFileSync(
      join(repo, '.loopwright/state', `${stateId(gone)}.json`),
      JSON.stringify({
        version: 1,
        task,
        stage: 'build',
        worktree: gone,
        branch: 'removed',
        lockedTests: [],
        history: [],
      }),
    );
  }

  it('lists a main-checkout state file whose worktree path no longer exists as worktree gone', () => {
    const { repo, wt } = repoWithWorktree();
    const gone = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-gone-'))), 'removed-wt');
    writeTask(
      repo,
      'orphan.md',
      taskText({ title: 'Orphan task', status: 'active', stage: 'build', worktree: gone, branch: 'removed' }),
    );
    goneState(repo, gone, 'tasks/orphan.md');
    const { all } = listTasks(wt);
    const hits = forTask(all, gone, 'orphan.md');
    expect(hits, 'listed with the missing worktree path').not.toHaveLength(0);
    expect(hits.some((n) => /worktree[ _-]?gone/i.test(describeNode(n)))).toBe(true);
  });

  it('lists a worktree-gone state file even when its task file is missing', () => {
    const { repo, wt } = repoWithWorktree();
    const gone = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-gone-'))), 'removed-wt');
    goneState(repo, gone, 'tasks/no-such-file.md');
    const { all } = listTasks(wt);
    const hits = forTask(all, gone, 'no-such-file.md');
    expect(hits).not.toHaveLength(0);
    expect(hits.some((n) => /worktree[ _-]?gone/i.test(describeNode(n)))).toBe(true);
  });

  it('never deletes or rewrites older-layout files', () => {
    const { repo, wt } = repoWithWorktree();
    const gone = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-gone-'))), 'removed-wt');
    const text = taskText({
      title: 'Older layout task',
      status: 'active',
      stage: 'build',
      worktree: wt,
      branch: 'feat',
    });
    writeTask(repo, 'old-wt-task.md', text);
    goneState(repo, gone, 'tasks/orphan.md');
    listTasks(wt);
    expect(readFileSync(join(repo, '.loopwright/tasks/old-wt-task.md'), 'utf8')).toBe(text);
    expect(files(join(repo, '.loopwright/state'))).toEqual([`${stateId(gone)}.json`]);
  });
});

describe('adopt: copy an older-layout task and its state into this worktree', () => {
  const lockedTests = [{ path: 'test/a.test.ts', sha256: 'a'.repeat(64) }];
  function olderLayout() {
    const { repo, wt } = repoWithWorktree();
    const text = taskText({
      title: 'Older layout task',
      status: 'active',
      stage: 'build',
      worktree: wt,
      branch: 'feat',
    });
    writeTask(repo, 'old-wt-task.md', text);
    const state = {
      version: 1,
      task: 'tasks/old-wt-task.md',
      stage: 'build',
      baseCommit: git(repo, ['rev-parse', 'HEAD']),
      worktree: wt,
      branch: 'feat',
      lockedTests,
      verdict: null,
      stopBlocks: 0,
      history: [],
    };
    mkdirSync(join(repo, '.loopwright/state'), { recursive: true });
    writeFileSync(join(repo, '.loopwright/state', `${stateId(wt)}.json`), JSON.stringify(state));
    return { repo, wt, text };
  }

  it('copies the task file and the state with its locked tests into this worktree', () => {
    const { wt, text } = olderLayout();
    const r = runLw(wt, ['adopt', 'tasks/old-wt-task.md']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(wt, '.loopwright/tasks/old-wt-task.md'), 'utf8')).toBe(text);
    const copied = JSON.parse(readFileSync(join(wt, '.loopwright/state', `${stateId(wt)}.json`), 'utf8'));
    expect(copied).toMatchObject({ task: 'tasks/old-wt-task.md', stage: 'build', worktree: wt, lockedTests });
  });

  it('marks the source task file status moved with the new path and does not delete it', () => {
    const { repo, wt } = olderLayout();
    expect(runLw(wt, ['adopt', 'tasks/old-wt-task.md']).code).toBe(0);
    const source = readFileSync(join(repo, '.loopwright/tasks/old-wt-task.md'), 'utf8');
    expect(source).toMatch(/^status: moved\s*$/m);
    expect(source).not.toMatch(/^status: active\s*$/m);
    expect(source).toContain(join(wt, '.loopwright/tasks/old-wt-task.md'));
  });

  it('makes status in the worktree print the adopted task with its locked tests', () => {
    const { wt } = olderLayout();
    expect(runLw(wt, ['status']).code).toBe(1);
    expect(runLw(wt, ['adopt', 'tasks/old-wt-task.md']).code).toBe(0);
    const s = runLw(wt, ['status']);
    expect(s.code, s.stderr).toBe(0);
    expect(JSON.parse(s.stdout)).toMatchObject({ task: 'tasks/old-wt-task.md', stage: 'build', lockedTests });
  });

  it('fails with its own message naming the task, writing nothing, when the main checkout has no such task', () => {
    const { repo, wt } = olderLayout();
    const r = runLw(wt, ['adopt', 'tasks/nope.md']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('tasks/nope.md');
    expect(files(join(wt, '.loopwright/tasks'))).toEqual([]);
    expect(files(join(wt, '.loopwright/state'))).toEqual([]);
    expect(readFileSync(join(repo, '.loopwright/tasks/old-wt-task.md'), 'utf8')).toMatch(/^status: active\s*$/m);
  });
});
