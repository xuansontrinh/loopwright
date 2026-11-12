import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isolatedEnv, loadFixture, makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-08-x.md';
const GUARD = resolve(__dirname, '../../content/hooks/guard-locked-tests.mjs');
const FIX = resolve(__dirname, '../fixtures/hooks');

const status = (repo: string) => JSON.parse(runLw(repo, ['status']).stdout);
const checkLocks = (repo: string) => JSON.parse(runLw(repo, ['check-locks']).stdout);
const relocked = (r: { relockedAfterReopen?: unknown }) => r.relockedAfterReopen ?? [];

/** A task past Build with a.txt locked. */
function built(): string {
  const repo = makeRepo();
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  runLw(repo, ['lock', 'a.txt']);
  runLw(repo, ['stage', 'build']);
  return repo;
}

describe('lw.mjs reopen', () => {
  it('after Build began, reopen test sets the stage and records the reason in history', () => {
    const repo = built();
    const r = runLw(repo, ['reopen', 'test', 'sibling bug needs a repro test']);
    expect(r.code).toBe(0);
    const s = status(repo);
    expect(s.stage).toBe('test');
    const events = s.history.filter((e: { event: string }) => e.event === 'reopen');
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).toContain('sibling bug needs a repro test');
    expect(JSON.stringify(events[0])).toContain('test');
  });

  it('after Build began, reopen plan sets the stage to plan', () => {
    const repo = built();
    runLw(repo, ['stage', 'review']);
    const r = runLw(repo, ['reopen', 'plan', 'user wants siblings included']);
    expect(r.code).toBe(0);
    const s = status(repo);
    expect(s.stage).toBe('plan');
    const events = s.history.filter((e: { event: string }) => e.event === 'reopen');
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).toContain('user wants siblings included');
  });

  it('reopen clears a pending awaitingUser', () => {
    const repo = built();
    runLw(repo, ['await-user', 'deviation']);
    expect(runLw(repo, ['reopen', 'test', 'deviation accepted as a test change']).code).toBe(0);
    expect(status(repo).awaitingUser).toBeUndefined();
  });

  it('reopen is refused before Build began and leaves the state unchanged', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', 'a.txt']);
    const before = status(repo);
    const r = runLw(repo, ['reopen', 'test', 'too early']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('loopwright:');
    const after = status(repo);
    expect(after.stage).toBe('test');
    expect(after.history).toEqual(before.history);
    // once Build has begun the same call is accepted
    runLw(repo, ['stage', 'build']);
    expect(runLw(repo, ['reopen', 'test', 'too early']).code).toBe(0);
  });

  it('reopen accepts only plan or test', () => {
    expect(runLw(built(), ['reopen', 'plan', 'valid target']).code).toBe(0);
    const repo = built();
    for (const target of ['build', 'review', 'done', 'bogus']) {
      const r = runLw(repo, ['reopen', target, 'some reason']);
      expect(r.code, target).toBe(1);
      expect(r.stderr, target).toContain('loopwright:');
    }
    expect(runLw(repo, ['reopen']).code).toBe(1);
    expect(status(repo).stage).toBe('build');
    expect(status(repo).history.some((e: { event: string }) => e.event === 'reopen')).toBe(false);
  });

  it('reopen without a reason is refused', () => {
    expect(runLw(built(), ['reopen', 'test', 'has a reason']).code).toBe(0);
    const repo = built();
    expect(runLw(repo, ['reopen', 'test']).code).toBe(1);
    expect(runLw(repo, ['reopen', 'test', '   ']).code).toBe(1);
    const s = status(repo);
    expect(s.stage).toBe('build');
    expect(s.history.some((e: { event: string }) => e.event === 'reopen')).toBe(false);
  });
});

describe('check-locks after reopen', () => {
  it('a re-lock after a reopen is relockedAfterReopen with its reason, not lockedAfterBuild', () => {
    const repo = built();
    runLw(repo, ['await-user', 'sibling repro needs a test change']);
    runLw(repo, ['resume']);
    runLw(repo, ['reopen', 'test', 'include sibling repro']);
    writeFileSync(join(repo, 'a.txt'), 'with sibling test\n');
    expect(runLw(repo, ['lock', 'a.txt']).code).toBe(0);
    runLw(repo, ['stage', 'build']);
    const r = runLw(repo, ['check-locks']);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(true);
    expect(out.lockedAfterBuild).toEqual([]);
    expect(out.relockedAfterReopen).toEqual([{ path: 'a.txt', reason: 'include sibling repro' }]);
  });

  it('a re-lock after reopen plan then test is also relockedAfterReopen', () => {
    const repo = built();
    runLw(repo, ['await-user', 'scope changed, user decision needed']);
    runLw(repo, ['resume']);
    runLw(repo, ['reopen', 'plan', 'scope changed']);
    runLw(repo, ['stage', 'test']);
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    const out = checkLocks(repo);
    expect(out.lockedAfterBuild).toEqual([]);
    expect(out.relockedAfterReopen).toEqual([{ path: 'a.txt', reason: 'scope changed' }]);
  });

  it('a re-lock after Build without a reopen stays in lockedAfterBuild', () => {
    const repo = built();
    runLw(repo, ['stage', 'test']);
    writeFileSync(join(repo, 'a.txt'), 'laundered\n');
    runLw(repo, ['lock', 'a.txt']);
    const out = checkLocks(repo);
    expect(out.lockedAfterBuild).toEqual(['a.txt']);
    expect(relocked(out)).toEqual([]);
  });

  it('a re-lock after a second Build without a new reopen is flagged again', () => {
    const repo = built();
    runLw(repo, ['reopen', 'test', 'first reopen']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['stage', 'test']);
    writeFileSync(join(repo, 'a.txt'), 'laundered later\n');
    runLw(repo, ['lock', 'a.txt']);
    const out = checkLocks(repo);
    expect(out.lockedAfterBuild).toEqual(['a.txt']);
  });

  it('reopen re-locks and plain re-locks of different paths are reported separately', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', 'a.txt', 'b.txt']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['await-user', 'sibling needs coverage']);
    runLw(repo, ['resume']);
    runLw(repo, ['reopen', 'test', 'cover sibling']);
    writeFileSync(join(repo, 'a.txt'), 'a2\n');
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['stage', 'test']);
    writeFileSync(join(repo, 'b.txt'), 'b2\n');
    runLw(repo, ['lock', 'b.txt']);
    const out = checkLocks(repo);
    expect(out.relockedAfterReopen).toEqual([{ path: 'a.txt', reason: 'cover sibling' }]);
    expect(out.lockedAfterBuild).toEqual(['b.txt']);
  });

  it('a locked test edited after reopen without re-locking is still reported as changed', () => {
    const repo = built();
    runLw(repo, ['reopen', 'test', 'cover sibling']);
    writeFileSync(join(repo, 'a.txt'), 'edited, not re-locked\n');
    runLw(repo, ['stage', 'build']);
    const r = runLw(repo, ['check-locks']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, changed: ['a.txt'] });
  });
});

describe('guard-locked-tests after reopen', () => {
  function guard(repo: string) {
    const input = JSON.stringify(loadFixture(join(FIX, 'claude-pretooluse.json'), repo));
    const r = spawnSync('node', [GUARD, '--tool', 'claude'], {
      cwd: repo,
      input,
      encoding: 'utf8',
      env: isolatedEnv(),
    });
    return { code: r.status, stderr: r.stderr };
  }

  it('blocks edits to locked tests again once the flow returns to Build', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    mkdirSync(join(repo, 'test'));
    writeFileSync(join(repo, 'test/t.test.ts'), 'x');
    expect(runLw(repo, ['lock', 'test/t.test.ts']).code).toBe(0);
    runLw(repo, ['stage', 'build']);
    expect(guard(repo).code).toBe(2);

    expect(runLw(repo, ['reopen', 'test', 'cover sibling']).code).toBe(0);
    expect(guard(repo).code).toBe(0); // the tester may edit in stage test
    writeFileSync(join(repo, 'test/t.test.ts'), 'y');
    expect(runLw(repo, ['lock', 'test/t.test.ts']).code).toBe(0);

    runLw(repo, ['stage', 'build']);
    const r = guard(repo);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('test/t.test.ts is a locked acceptance test');
  });

  it('blocks edits in Build after reopen plan, test and Build again', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    mkdirSync(join(repo, 'test'));
    writeFileSync(join(repo, 'test/t.test.ts'), 'x');
    runLw(repo, ['lock', 'test/t.test.ts']);
    runLw(repo, ['stage', 'build']);
    expect(runLw(repo, ['reopen', 'plan', 'scope changed']).code).toBe(0);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['stage', 'build']);
    expect(guard(repo).code).toBe(2);
  });
});
