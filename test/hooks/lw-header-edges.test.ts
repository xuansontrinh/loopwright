import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/t.md';

function built(content: string): { repo: string; file: string } {
  const repo = makeRepo();
  const file = join(repo, '.loopwright', TASK);
  writeFileSync(file, content);
  expect(runLw(repo, ['start', TASK]).code).toBe(0);
  runLw(repo, ['stage', 'test']);
  runLw(repo, ['stage', 'build']);
  return { repo, file };
}

describe('task header writes at the edges', () => {
  it('reports header false when the task file is gone, and still changes state', () => {
    const { repo, file } = built('# T\n\nstatus: active\nstage: plan\n\n## Goal\n\nx\n');
    rmSync(file);
    const r = runLw(repo, ['stage', 'review']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ stage: 'review', header: false });
    expect(JSON.parse(runLw(repo, ['status']).stdout).stage).toBe('review');
  });

  it('a reopen to plan with no plan line still sets stage but reports header false', () => {
    const { repo, file } = built('# T\n\nstatus: active\nstage: build\n\n## Goal\n\nx\n');
    const r = runLw(repo, ['reopen', 'plan', 'scope grew']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ stage: 'plan', reopened: true, header: false });
    expect(r.stderr).toContain('task file header not updated');
    expect(readFileSync(file, 'utf8')).toMatch(/^stage: plan$/m);
  });

  it('keeps the rest of the header and the body byte for byte', () => {
    const text = '# T\n\nstatus: active\nstage: plan\ntier: large\n\n## Goal\n\nplan: confirmed\n';
    const { repo, file } = built(text);
    runLw(repo, ['reopen', 'plan', 'scope grew']);
    expect(readFileSync(file, 'utf8')).toBe(text);
    runLw(repo, ['stage', 'test']);
    expect(readFileSync(file, 'utf8')).toBe(text.replace('stage: plan', 'stage: test'));
  });
});
