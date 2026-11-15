import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isolatedEnv, loadFixture, makeRepo, runLw } from './helpers.js';

const STOP_GATE = resolve(__dirname, '../../content/hooks/stop-gate.mjs');
const FIX = resolve(__dirname, '../fixtures/hooks');
const TASK = 'tasks/2026-11-14-x.md';

function newTask(): string {
  const repo = makeRepo();
  writeFileSync(
    join(repo, '.loopwright/tasks/2026-11-14-x.md'),
    '# Title\n\nstatus: active\nstage: plan\n\n## Goal\n\nShip the widget.\n',
  );
  expect(runLw(repo, ['start', TASK]).code).toBe(0);
  return repo;
}

function stop(repo: string) {
  const input = JSON.stringify(loadFixture(join(FIX, 'claude-stop.json'), repo));
  const r = spawnSync('node', [STOP_GATE, '--tool', 'claude'], {
    cwd: repo,
    input,
    encoding: 'utf8',
    env: isolatedEnv(),
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('stop gate at a safe point', () => {
  it('lets the turn end after a passed slice review once the stage is test', () => {
    const repo = newTask();
    mkdirSync(join(repo, 'test'));
    writeFileSync(join(repo, 'test/t.test.ts'), 'x');
    expect(runLw(repo, ['stage', 'test']).code).toBe(0);
    expect(runLw(repo, ['lock', 'test/t.test.ts']).code).toBe(0);
    for (const stage of ['build', 'review']) expect(runLw(repo, ['stage', stage]).code).toBe(0);
    expect(runLw(repo, ['verdict', 'pass', '--round', '1']).code).toBe(0);
    expect(runLw(repo, ['stage', 'test']).code).toBe(0);
    const r = stop(repo);
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('no passing review');
  });

  it('lets the turn end after plan confirmation once the stage is test', () => {
    const repo = newTask();
    expect(runLw(repo, ['stage', 'test']).code).toBe(0);
    const r = stop(repo);
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('no passing review');
  });
});
