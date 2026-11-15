import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { LW, makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/t.md';
const ROLES = ['scout', 'tester', 'implementer', 'reviewer'] as const;

/** A repo with a started task whose header says `profile: thorough`. */
function started(): string {
  const repo = makeRepo();
  writeFileSync(
    join(repo, '.loopwright', TASK),
    '# T\n\nstatus: active\nstage: plan\nprofile: thorough\n\n## Goal\n\nx\n',
  );
  expect(runLw(repo, ['start', TASK]).code).toBe(0);
  return repo;
}

const brief = (repo: string, ...args: string[]) => JSON.parse(runLw(repo, ['brief', ...args]).stdout);

describe('lw.mjs brief', () => {
  it('returns dir, task, stage, config and effort in one call', () => {
    const repo = started();
    const r = runLw(repo, ['brief', 'reviewer']);
    expect(r.code).toBe(0);
    const b = JSON.parse(r.stdout);
    expect(b).toMatchObject({ task: TASK, stage: 'plan', reopened: null, effort: 'xhigh' });
    expect(b.config).toMatchObject({ maxFixRounds: 3, crossAgentReview: 'off', docsDir: 'docs/agents' });
    expect(b.config.crossAgentReviewer).toEqual(DEFAULT_CONFIG.models.crossAgentReviewer);
    expect(Object.keys(b.config).sort()).toEqual(
      ['crossAgentReview', 'crossAgentReviewer', 'docsDir', 'maxFixRounds'].sort(),
    );
    expect(b.dir).toBe(runLw(repo, ['dir']).stdout.trim());
    expect(b).not.toHaveProperty('history');
  });

  it('effort matches the effort command for every role', () => {
    const repo = started();
    for (const role of ROLES) {
      expect(brief(repo, role).effort, role).toBe(runLw(repo, ['effort', role]).stdout.trim());
    }
  });

  it('carries the base commit and has no effort without a role', () => {
    const repo = started();
    const b = brief(repo);
    expect(b.baseCommit).toBe(JSON.parse(runLw(repo, ['status']).stdout).baseCommit);
    expect(b).not.toHaveProperty('effort');
  });

  it('reads config values from the repo config file', () => {
    const repo = started();
    writeFileSync(
      join(repo, '.loopwright/config.json'),
      JSON.stringify({ ...DEFAULT_CONFIG, maxFixRounds: 5, docsDir: 'notes' }),
    );
    expect(brief(repo).config).toMatchObject({ maxFixRounds: 5, docsDir: 'notes' });
  });

  it('works before any task has started', () => {
    const repo = makeRepo();
    const r = runLw(repo, ['brief']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ task: null, reopened: null });
  });

  it('reports a reopen that follows the last build', () => {
    const repo = started();
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['reopen', 'test', 'criterion was wrong']);
    expect(brief(repo).reopened).toEqual({ target: 'test', reason: 'criterion was wrong' });
  });

  it('keeps the reopen while the reopened stage runs, and reports the last of several', () => {
    const repo = started();
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['reopen', 'test', 'first reason']);
    runLw(repo, ['stage', 'test']);
    expect(brief(repo).reopened).toEqual({ target: 'test', reason: 'first reason' });
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['reopen', 'plan', 'second reason']);
    expect(brief(repo).reopened).toEqual({ target: 'plan', reason: 'second reason' });
  });

  it('drops the reopen once build has started again', () => {
    const repo = started();
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['stage', 'build']);
    runLw(repo, ['reopen', 'test', 'criterion was wrong']);
    runLw(repo, ['stage', 'test']);
    runLw(repo, ['stage', 'build']);
    expect(brief(repo).reopened).toBeNull();
  });

  it('rejects an unknown role with the effort usage message', () => {
    const r = runLw(started(), ['brief', 'nobody']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('usage: effort <');
  });

  it('is listed in the usage string', () => {
    const usage =
      readFileSync(LW, 'utf8')
        .match(/usage: lw\.mjs <([^>]+)>/)?.[1]
        ?.split('|') ?? [];
    expect(usage).toContain('brief');
  });
});
