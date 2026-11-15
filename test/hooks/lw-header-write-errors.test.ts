import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/t.md';

function started(content: string): { repo: string; file: string } {
  const repo = makeRepo();
  const file = join(repo, '.loopwright', TASK);
  writeFileSync(file, content);
  expect(runLw(repo, ['start', TASK]).code).toBe(0);
  return { repo, file };
}

const stageOf = (repo: string) => JSON.parse(runLw(repo, ['status']).stdout).stage;

// File modes do not block writes on Windows or for root.
const canBlockWrites = process.platform !== 'win32' && process.getuid?.() !== 0;

describe('task header write errors', () => {
  it.skipIf(!canBlockWrites)('stage keeps exit 0 and reports header false when the file is read-only', () => {
    const { repo, file } = started('# T\n\nstatus: active\nstage: plan\n\n## Goal\n\nx\n');
    chmodSync(file, 0o444);
    const r = runLw(repo, ['stage', 'test']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ stage: 'test', header: false });
    expect(r.stderr).toContain('task file header not updated');
    expect(stageOf(repo)).toBe('test');
    expect(readFileSync(file, 'utf8')).toContain('stage: plan');
  });

  it('names the stage line when the header has none', () => {
    const { repo } = started('# T\n\nstatus: active\n\n## Goal\n\nx\n');
    const r = runLw(repo, ['stage', 'test']);
    expect(r.stderr).toContain('task file header not updated');
    expect(r.stderr).toContain('no "stage:" line');
  });

  it('names the plan line when only that one is missing on a reopen to plan', () => {
    const { repo } = started('# T\n\nstatus: active\nstage: plan\n\n## Goal\n\nx\n');
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['stage', 'build']);
    const r = runLw(repo, ['reopen', 'plan', 'scope grew']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('no "plan:" line');
    expect(r.stderr).not.toContain('no "stage:" line');
  });

  it('says the task file is missing, once, when it is gone', () => {
    const { repo, file } = started('# T\n\nstatus: active\nstage: plan\nplan: draft\n\n## Goal\n\nx\n');
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['stage', 'build']);
    rmSync(file);
    const r = runLw(repo, ['reopen', 'plan', 'scope grew']);
    expect(r.code).toBe(0);
    expect(r.stderr.match(/task file missing/g)).toHaveLength(1);
  });
});
