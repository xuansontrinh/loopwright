import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isolatedEnv, makeRepo, runLw } from './helpers.js';

const STOP_GATE = resolve(__dirname, '../../content/hooks/stop-gate.mjs');
const WAIT = 'handing a new goal to a new worktree';

const stop = (repo: string) =>
  spawnSync('node', [STOP_GATE, '--tool', 'claude'], {
    cwd: repo,
    input: JSON.stringify({ cwd: repo, hook_event_name: 'Stop' }),
    encoding: 'utf8',
    env: isolatedEnv(),
  });

const status = (repo: string) => JSON.parse(runLw(repo, ['status']).stdout);

function taskInBuild(): string {
  const repo = makeRepo();
  writeFileSync(join(repo, '.loopwright/tasks/2026-11-13-x.md'), '# X\n\n## Goal\n\nShip the widget.\n');
  runLw(repo, ['start', 'tasks/2026-11-13-x.md']);
  runLw(repo, ['stage', 'build']);
  return repo;
}

describe('stop gate across the turns of a goal intake on an occupied worktree', () => {
  it('blocks the unrelated task without the wait, so the wait has to come first', () => {
    const repo = taskInBuild();
    expect(stop(repo).status).toBe(2);
    expect(status(repo).stopBlocks).toBe(1);
  });

  it('stands down on every turn after await-user and spends no stop-block', () => {
    const repo = taskInBuild();
    expect(runLw(repo, ['await-user', WAIT]).code).toBe(0);
    // question turn, answer turn, start-command turn, and a later user message
    for (let turn = 0; turn < 4; turn++) {
      const r = stop(repo);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(status(repo).stopBlocks).toBe(0);
      expect(status(repo).awaitingUser).toBe(WAIT);
    }
  });

  it('stage build, the task own work resuming, clears the wait so the gate applies again', () => {
    const repo = taskInBuild();
    runLw(repo, ['await-user', WAIT]);
    expect(stop(repo).status).toBe(0);
    runLw(repo, ['stage', 'build']);
    expect(status(repo).awaitingUser).toBeUndefined();
    expect(stop(repo).status).toBe(2);
    expect(status(repo).stopBlocks).toBe(1);
  });
});
