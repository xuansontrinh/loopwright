import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/t.md';

/** A repo with a started task whose file holds `content`. */
function started(content: string): { repo: string; file: string } {
  const repo = makeRepo();
  const file = join(repo, '.loopwright', TASK);
  writeFileSync(file, content);
  expect(runLw(repo, ['start', TASK]).code).toBe(0);
  return { repo, file };
}

const HEADER = '# T\n\nstatus: active\nstage: plan\nplan: confirmed\n\n## Goal\n\nx\n';
const status = (repo: string) => JSON.parse(runLw(repo, ['status']).stdout);

describe('lw.mjs stage writes the task header', () => {
  it('sets stage in the task file header and prints a short result', () => {
    const { repo, file } = started(HEADER);
    const r = runLw(repo, ['stage', 'test']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ stage: 'test', header: true });
    expect(readFileSync(file, 'utf8')).toMatch(/^stage: test$/m);
    expect(status(repo).stage).toBe('test');
  });

  it('leaves a "stage:" line in the body alone', () => {
    const { repo, file } = started(`${HEADER}\n## Notes\n\nstage: plan is where we started\n`);
    runLw(repo, ['stage', 'test']);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('stage: plan is where we started');
    expect(text).toMatch(/^stage: test$/m);
  });

  it('keeps CRLF line endings', () => {
    const { repo, file } = started(HEADER.replace(/\n/g, '\r\n'));
    expect(JSON.parse(runLw(repo, ['stage', 'test']).stdout)).toEqual({ stage: 'test', header: true });
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('stage: test\r\n');
    expect(text).not.toMatch(/[^\r]\n/);
  });

  it('still changes state when the header has no stage line', () => {
    const { repo, file } = started('# T\n\nstatus: active\n\n## Goal\n\nx\n');
    const r = runLw(repo, ['stage', 'build']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ stage: 'build', header: false });
    expect(r.stderr).toContain('task file header not updated');
    expect(status(repo).stage).toBe('build');
    expect(readFileSync(file, 'utf8')).toBe('# T\n\nstatus: active\n\n## Goal\n\nx\n');
  });

  it('does not take a body stage line for the header line', () => {
    const { repo, file } = started('# T\n\nstatus: active\n\n## Notes\n\nstage: plan\n');
    const r = runLw(repo, ['stage', 'test']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ stage: 'test', header: false });
    expect(r.stderr).toContain('task file header not updated');
    expect(readFileSync(file, 'utf8')).toContain('stage: plan\n');
  });
});

describe('lw.mjs reopen writes the task header', () => {
  function built(content = HEADER) {
    const t = started(content);
    runLw(t.repo, ['stage', 'test']);
    runLw(t.repo, ['stage', 'build']);
    return t;
  }

  it('sets stage and plan: draft on a reopen to plan', () => {
    const { repo, file } = built();
    const r = runLw(repo, ['reopen', 'plan', 'scope grew']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ stage: 'plan', reopened: true, header: true });
    const text = readFileSync(file, 'utf8');
    expect(text).toMatch(/^stage: plan$/m);
    expect(text).toMatch(/^plan: draft$/m);
    expect(text).not.toContain('plan: confirmed');
    expect(status(repo).stage).toBe('plan');
  });

  it('sets stage on a reopen to test and leaves plan alone', () => {
    const { repo, file } = built();
    const r = runLw(repo, ['reopen', 'test', 'criterion was wrong']);
    expect(JSON.parse(r.stdout)).toEqual({ stage: 'test', reopened: true, header: true });
    const text = readFileSync(file, 'utf8');
    expect(text).toMatch(/^stage: test$/m);
    expect(text).toMatch(/^plan: confirmed$/m);
  });
});
