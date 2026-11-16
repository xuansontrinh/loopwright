import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-08-x.md';
const REASON = 'the user approved the re-lock in a decision';

const checkLocks = (repo: string) => runLw(repo, ['check-locks']);
const locks = (repo: string) => JSON.parse(checkLocks(repo).stdout);
const brief = (repo: string) => JSON.parse(runLw(repo, ['brief', 'reviewer']).stdout);
const historyLength = (repo: string) => JSON.parse(runLw(repo, ['status']).stdout).history.length;
const stateOf = (repo: string) => runLw(repo, ['status']).stdout;

/** A task whose a.txt is locked, Build has begun, and a.txt was then re-locked after changing it. */
function relocked(): string {
  const repo = makeRepo();
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  runLw(repo, ['lock', 'a.txt']);
  runLw(repo, ['stage', 'build']);
  runLw(repo, ['stage', 'test']);
  writeFileSync(join(repo, 'a.txt'), 'rewritten\n');
  runLw(repo, ['lock', 'a.txt']);
  runLw(repo, ['stage', 'build']);
  return repo;
}

/** A task that was force-restarted after Build began, with every lock still matching. */
function restarted(): string {
  const repo = makeRepo();
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  runLw(repo, ['lock', 'a.txt']);
  runLw(repo, ['stage', 'build']);
  runLw(repo, ['start', TASK, '--force']);
  runLw(repo, ['stage', 'build']);
  return repo;
}

describe('accept-locks takes flagged items out of check-locks', () => {
  it('a named re-locked path leaves lockedAfterBuild and is listed under accepted with its reason', () => {
    const repo = relocked();
    expect(locks(repo).lockedAfterBuild).toEqual(['a.txt']);
    const r = runLw(repo, ['accept-locks', '--reason', REASON, 'a.txt']);
    expect(r.code).toBe(0);
    const after = checkLocks(repo);
    expect(after.code).toBe(0);
    const out = JSON.parse(after.stdout);
    expect(out.ok).toBe(true);
    expect(out.lockedAfterBuild).toEqual([]);
    expect(out.accepted).toEqual([{ path: 'a.txt', reason: REASON }]);
  });

  it('accepting a path leaves the forced restart flagged', () => {
    const repo = relocked();
    runLw(repo, ['start', TASK, '--force']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['accept-locks', '--reason', REASON, 'a.txt']);
    const out = locks(repo);
    expect(out.lockedAfterBuild).toEqual([]);
    expect(out.forcedRestartAfterBuild).toBe(true);
  });

  it('--restart clears the forced restart and lists it under accepted with its reason', () => {
    const repo = restarted();
    expect(locks(repo).forcedRestartAfterBuild).toBe(true);
    expect(runLw(repo, ['accept-locks', '--reason', REASON, '--restart']).code).toBe(0);
    const out = locks(repo);
    expect(out.forcedRestartAfterBuild).toBe(false);
    expect(out.accepted).toEqual([{ restart: true, reason: REASON }]);
  });

  it('--restart leaves a flagged re-locked path in lockedAfterBuild', () => {
    const repo = relocked();
    runLw(repo, ['start', TASK, '--force']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['accept-locks', '--reason', REASON, '--restart']);
    const out = locks(repo);
    expect(out.forcedRestartAfterBuild).toBe(false);
    expect(out.lockedAfterBuild).toEqual(['a.txt']);
  });

  it('several paths and the restart are accepted in one call', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', 'a.txt', 'b.txt']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['stage', 'test']);
    writeFileSync(join(repo, 'a.txt'), 'rewritten\n');
    writeFileSync(join(repo, 'b.txt'), 'rewritten\n');
    runLw(repo, ['lock', 'a.txt', 'b.txt']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['start', TASK, '--force']);
    runLw(repo, ['stage', 'build']);
    expect(runLw(repo, ['accept-locks', '--reason', REASON, '--restart', 'a.txt', 'b.txt']).code).toBe(0);
    const out = locks(repo);
    expect(out.lockedAfterBuild).toEqual([]);
    expect(out.forcedRestartAfterBuild).toBe(false);
    expect(out.accepted).toHaveLength(3);
    expect(out.accepted).toContainEqual({ path: 'b.txt', reason: REASON });
    expect(out.accepted).toContainEqual({ restart: true, reason: REASON });
  });

  it('a named path that is not flagged is skipped and listed under notFlagged', () => {
    const repo = relocked();
    const r = runLw(repo, ['accept-locks', '--reason', REASON, 'a.txt', 'other.txt']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).notFlagged).toEqual(['other.txt']);
    const out = locks(repo);
    expect(out.lockedAfterBuild).toEqual([]);
    expect(out.accepted).toEqual([{ path: 'a.txt', reason: REASON }]);
  });

  it('accepting the same path twice lists it once', () => {
    const repo = relocked();
    runLw(repo, ['accept-locks', '--reason', REASON, 'a.txt']);
    const again = runLw(repo, ['accept-locks', '--reason', 'second reason', 'a.txt']);
    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout).notFlagged).toEqual(['a.txt']);
    expect(locks(repo).accepted).toEqual([{ path: 'a.txt', reason: REASON }]);
  });

  it('naming nothing that is flagged writes no history event and changes no state', () => {
    const repo = restarted();
    const before = stateOf(repo);
    const length = historyLength(repo);
    const r = runLw(repo, ['accept-locks', '--reason', REASON, 'a.txt']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).notFlagged).toEqual(['a.txt']);
    expect(historyLength(repo)).toBe(length);
    expect(stateOf(repo)).toBe(before);
  });

  it('--restart with no forced restart is skipped and writes no history event', () => {
    const repo = relocked();
    const length = historyLength(repo);
    const r = runLw(repo, ['accept-locks', '--reason', REASON, '--restart']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).notFlagged).toHaveLength(1);
    expect(historyLength(repo)).toBe(length);
    expect(locks(repo).lockedAfterBuild).toEqual(['a.txt']);
  });

  it('accepting something writes a history event', () => {
    const repo = relocked();
    const length = historyLength(repo);
    runLw(repo, ['accept-locks', '--reason', REASON, 'a.txt']);
    expect(historyLength(repo)).toBeGreaterThan(length);
  });
});

describe('accept-locks covers only what existed when it ran', () => {
  it('re-locking an accepted path after a later build flags it again', () => {
    const repo = relocked();
    runLw(repo, ['accept-locks', '--reason', REASON, 'a.txt']);
    runLw(repo, ['stage', 'test']);
    writeFileSync(join(repo, 'a.txt'), 'rewritten again\n');
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    expect(locks(repo).lockedAfterBuild).toEqual(['a.txt']);
  });

  it('a forced restart after the acceptance flags the restart again', () => {
    const repo = restarted();
    runLw(repo, ['accept-locks', '--reason', REASON, '--restart']);
    expect(locks(repo).forcedRestartAfterBuild).toBe(false);
    runLw(repo, ['start', TASK, '--force']);
    runLw(repo, ['stage', 'build']);
    expect(locks(repo).forcedRestartAfterBuild).toBe(true);
  });

  it('a locked test edited without a re-lock stays changed and blocking, also when named', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    writeFileSync(join(repo, 'a.txt'), 'tampered\n');
    const blocked = (label: string) => {
      const r = checkLocks(repo);
      expect(r.code, label).toBe(1);
      const out = JSON.parse(r.stdout);
      expect(out.ok, label).toBe(false);
      expect(out.changed, label).toEqual(['a.txt']);
    };
    blocked('before');
    expect(runLw(repo, ['accept-locks', '--reason', REASON, 'a.txt']).code).toBe(0);
    blocked('after');
  });

  it('a re-locked test edited again without a re-lock stays changed after it is accepted', () => {
    const repo = relocked();
    runLw(repo, ['accept-locks', '--reason', REASON, 'a.txt']);
    writeFileSync(join(repo, 'a.txt'), 'tampered\n');
    const r = checkLocks(repo);
    expect(r.code).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(false);
    expect(out.changed).toEqual(['a.txt']);
  });
});

describe('accept-locks errors', () => {
  it('a missing --reason exits 1 with its own message and writes no state', () => {
    const repo = relocked();
    const before = stateOf(repo);
    const r = runLw(repo, ['accept-locks', 'a.txt']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('accept-locks');
    expect(r.stderr).toContain('--reason');
    expect(stateOf(repo)).toBe(before);
    expect(locks(repo).lockedAfterBuild).toEqual(['a.txt']);
  });

  it('a --reason without a value exits 1 with its own message and writes no state', () => {
    const repo = relocked();
    const before = stateOf(repo);
    const r = runLw(repo, ['accept-locks', 'a.txt', '--reason']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--reason requires a value');
    expect(stateOf(repo)).toBe(before);
  });

  it('neither a path nor --restart exits 1 with its own message and writes no state', () => {
    const repo = relocked();
    const before = stateOf(repo);
    const r = runLw(repo, ['accept-locks', '--reason', REASON]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('accept-locks');
    expect(r.stderr).toContain('--restart');
    expect(stateOf(repo)).toBe(before);
  });

  it('no active task exits 1 with its own message and writes no state', () => {
    const repo = makeRepo();
    const r = runLw(repo, ['accept-locks', '--reason', REASON, 'a.txt']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no active task');
    expect(readdirSync(join(repo, '.loopwright', 'state'))).toEqual([]);
  });
});

describe('brief flaggedLocks', () => {
  it('is absent when nothing is flagged', () => {
    const repo = makeRepo();
    runLw(repo, ['start', TASK]);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    expect(brief(repo)).not.toHaveProperty('flaggedLocks');
  });

  it('is absent when there is no active task', () => {
    expect(brief(makeRepo())).not.toHaveProperty('flaggedLocks');
  });

  it('lists a flagged re-lock', () => {
    expect(brief(relocked()).flaggedLocks).toEqual({ lockedAfterBuild: ['a.txt'], forcedRestartAfterBuild: false });
  });

  it('flags a forced restart', () => {
    expect(brief(restarted()).flaggedLocks).toEqual({ lockedAfterBuild: [], forcedRestartAfterBuild: true });
  });

  it('keeps only what is not accepted yet', () => {
    const repo = relocked();
    runLw(repo, ['start', TASK, '--force']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['accept-locks', '--reason', REASON, 'a.txt']);
    expect(brief(repo).flaggedLocks).toEqual({ lockedAfterBuild: [], forcedRestartAfterBuild: true });
  });

  it('is absent once everything flagged is accepted', () => {
    const repo = relocked();
    runLw(repo, ['start', TASK, '--force']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['accept-locks', '--reason', REASON, '--restart', 'a.txt']);
    expect(brief(repo)).not.toHaveProperty('flaggedLocks');
  });

  it('comes back when an accepted path is re-locked again', () => {
    const repo = relocked();
    runLw(repo, ['accept-locks', '--reason', REASON, 'a.txt']);
    runLw(repo, ['stage', 'test']);
    writeFileSync(join(repo, 'a.txt'), 'rewritten again\n');
    runLw(repo, ['lock', 'a.txt']);
    runLw(repo, ['stage', 'build']);
    expect(brief(repo).flaggedLocks).toEqual({ lockedAfterBuild: ['a.txt'], forcedRestartAfterBuild: false });
  });
});
