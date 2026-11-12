import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, makeBareRepo, makeRepo, runLw } from './helpers.js';

const env = () => {
  const h = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-explore-home-')));
  return { HOME: h, USERPROFILE: h };
};
const localDate = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const head = (repo: string) => git(repo, ['rev-parse', 'HEAD']);
const exploreDir = (repo: string) => join(repo, '.loopwright/explore');
const runs = (repo: string) => (existsSync(exploreDir(repo)) ? readdirSync(exploreDir(repo)).sort() : []);
const runMd = (repo: string, dir: string) => readFileSync(join(repo, '.loopwright', dir, 'run.md'), 'utf8');
const explore = (repo: string, args: string[], e = env()) => runLw(repo, ['explore', ...args], undefined, e);
const ok = (repo: string, args: string[]) => {
  const r = explore(repo, args);
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
};
const withScope = (repo: string, rel = 'services/billing') => {
  mkdirSync(join(repo, rel), { recursive: true });
  writeFileSync(join(repo, rel, 'x.txt'), 'x\n');
  return repo;
};
const setStatus = (repo: string, dir: string, status: string) => {
  const f = join(repo, '.loopwright', dir, 'run.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^status: .*$/m, `status: ${status}`));
};

describe('lw.mjs explore: new run', () => {
  it('creates the run folder and run.md for a folder scope, creating .loopwright/ when missing', () => {
    const repo = withScope(makeBareRepo());
    expect(existsSync(join(repo, '.loopwright'))).toBe(false);
    const out = ok(repo, ['services/billing']);
    expect(out.dir).toBe(`explore/${localDate()}-services-billing`);
    expect(out.resume).toBe(false);
    expect(out.present).toEqual([]);
    expect(out.commit).toBe(head(repo));
    expect(out.head).toBe(head(repo));
    const text = runMd(repo, out.dir);
    expect(text).toMatch(/^scope: services\/billing$/m);
    expect(text).toContain(`commit: ${head(repo)}`);
    expect(text).toContain(`started: ${localDate()}`);
    expect(text).toMatch(/^status: in-progress$/m);
  });

  it('uses the slug "repo" for the whole repository scope', () => {
    const repo = makeRepo();
    const out = ok(repo, ['.']);
    expect(out.dir).toBe(`explore/${localDate()}-repo`);
    expect(runMd(repo, out.dir)).toMatch(/^scope: \.$/m);
  });

  it('suffixes -2 when the folder name is taken by a finished run', () => {
    const repo = withScope(makeRepo());
    const first = ok(repo, ['services/billing']);
    setStatus(repo, first.dir, 'done');
    const second = ok(repo, ['services/billing']);
    expect(second.resume).toBe(false);
    expect(second.dir).toBe(`${first.dir}-2`);
    expect(runs(repo)).toEqual([first.dir.replace('explore/', ''), second.dir.replace('explore/', '')]);
  });
});

describe('lw.mjs explore: resume', () => {
  it('returns the same folder with resume true and lists files recursively, for a normalized scope', () => {
    const repo = withScope(makeRepo());
    const first = ok(repo, ['services/billing']);
    const base = join(repo, '.loopwright', first.dir);
    mkdirSync(join(base, 'components'), { recursive: true });
    writeFileSync(join(base, 'map.md'), 'm\n');
    writeFileSync(join(base, 'components/api.md'), 'a\n');
    writeFileSync(join(base, 'components/db.md'), 'd\n');
    const again = ok(repo, ['./services/billing/']);
    expect(again.dir).toBe(first.dir);
    expect(again.resume).toBe(true);
    expect(again.present).toEqual(['components/api.md', 'components/db.md', 'map.md', 'run.md']);
    expect(runs(repo)).toHaveLength(1);
  });

  it('does not resume done or abandoned runs, or runs of another scope', () => {
    const repo = withScope(withScope(makeRepo()), 'services/other');
    const a = ok(repo, ['services/billing']);
    const other = ok(repo, ['services/other']);
    expect(other.resume).toBe(false);
    expect(other.dir).not.toBe(a.dir);
    setStatus(repo, a.dir, 'done');
    expect(ok(repo, ['services/billing']).resume).toBe(false);
    const c = readdirSync(exploreDir(repo))
      .filter((d) => d.includes('billing'))
      .sort();
    const newest = `explore/${c[c.length - 1]}`;
    setStatus(repo, newest, 'abandoned');
    const d = ok(repo, ['services/billing']);
    expect(d.resume).toBe(false);
    expect(d.dir).not.toBe(newest);
  });

  it('--new abandons the in-progress run and creates a new one', () => {
    const repo = withScope(makeRepo());
    const first = ok(repo, ['services/billing']);
    const fresh = ok(repo, ['services/billing', '--new']);
    expect(fresh.resume).toBe(false);
    expect(fresh.dir).not.toBe(first.dir);
    expect(runMd(repo, first.dir)).toMatch(/^status: abandoned$/m);
    expect(runMd(repo, fresh.dir)).toMatch(/^status: in-progress$/m);
    const next = ok(repo, ['services/billing']);
    expect(next.dir).toBe(fresh.dir);
    expect(next.resume).toBe(true);
  });
});

describe('lw.mjs explore: commits', () => {
  it('keeps the start commit while head follows new commits', () => {
    const repo = withScope(makeRepo());
    const first = ok(repo, ['services/billing']);
    const start = head(repo);
    writeFileSync(join(repo, 'b.txt'), 'two\n');
    git(repo, ['add', 'b.txt']);
    git(repo, ['commit', '-q', '-m', 'second']);
    const again = ok(repo, ['services/billing']);
    expect(again.dir).toBe(first.dir);
    expect(again.commit).toBe(start);
    expect(again.head).toBe(head(repo));
    expect(again.head).not.toBe(start);
  });

  it('reports null commit and head in a repo without commits', () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-explore-empty-')));
    git(dir, ['init', '-q', '-b', 'main']);
    const out = ok(dir, ['.']);
    expect(out.commit).toBeNull();
    expect(out.head).toBeNull();
    expect(out.resume).toBe(false);
  });
});

describe('lw.mjs explore: errors and state', () => {
  it('fails on a missing scope path with its own message and writes nothing', () => {
    const repo = makeBareRepo();
    const r = explore(repo, ['no/such/place']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/explore/);
    expect(r.stderr).toContain('no/such/place');
    expect(r.stderr).not.toMatch(/unknown command/i);
    expect(existsSync(join(repo, '.loopwright'))).toBe(false);
    const repo2 = makeRepo();
    expect(explore(repo2, ['nope']).code).toBe(1);
    expect(runs(repo2)).toEqual([]);
  });

  it('accepts a file as scope', () => {
    const repo = makeRepo();
    const out = ok(repo, ['a.txt']);
    expect(runMd(repo, out.dir)).toMatch(/^scope: a\.txt$/m);
  });

  it('works with no active task and leaves the worktree state file byte-identical', () => {
    const repo = withScope(makeRepo());
    expect(explore(repo, ['services/billing']).code).toBe(0);
    const A = 'tasks/2026-11-01-task-a.md';
    writeFileSync(join(repo, '.loopwright', A), '# A\n\nstatus: active\n\n## Goal\nx\n');
    const e = env();
    expect(runLw(repo, ['start', A], undefined, e).code).toBe(0);
    const sdir = join(repo, '.loopwright/state');
    const snap = () =>
      readdirSync(sdir)
        .sort()
        .map((f) => [f, readFileSync(join(sdir, f), 'utf8')]);
    const before = snap();
    expect(before.length).toBeGreaterThan(0);
    expect(explore(repo, ['services/billing'], e).code).toBe(0);
    expect(explore(repo, ['services/billing', '--new'], e).code).toBe(0);
    expect(snap()).toEqual(before);
  });
});
