import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/t.md';
const HEADER = '# T\n\nstatus: active\nstage: plan\nprofile: thorough\n\n## Goal\n\nx\n';

function started(header = HEADER): string {
  const repo = makeRepo();
  writeFileSync(join(repo, '.loopwright', TASK), header);
  writeFileSync(join(repo, 'a.test.ts'), 'x\n');
  expect(runLw(repo, ['start', TASK]).code).toBe(0);
  return repo;
}

const json = (repo: string, ...args: string[]) => JSON.parse(runLw(repo, args).stdout);

describe('lw.mjs brief state fields', () => {
  it('carries lockedTests, verdict and awaitingUser exactly as status has them', () => {
    const repo = started();
    expect(runLw(repo, ['stage', 'test']).code).toBe(0);
    expect(runLw(repo, ['lock', 'a.test.ts']).code).toBe(0);
    expect(runLw(repo, ['verdict', 'pass', '--round', '1']).code).toBe(0);
    expect(runLw(repo, ['await-user', 'a question']).code).toBe(0);
    const status = json(repo, 'status');
    const brief = json(repo, 'brief');
    expect(status.lockedTests).toHaveLength(1);
    expect(brief.lockedTests).toEqual(status.lockedTests);
    expect(brief.verdict).toEqual(status.verdict);
    expect(brief.verdict.pass).toBe(true);
    expect(brief.awaitingUser).toBe('a question');
  });
});

describe('lw.mjs brief with a bad value', () => {
  it('omits effort and warns when the task profile is unknown', () => {
    const repo = started(HEADER.replace('thorough', 'nope'));
    const r = runLw(repo, ['brief', 'reviewer']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("unknown profile 'nope'");
    expect(r.stderr).toContain('brief has no effort');
    const b = JSON.parse(r.stdout);
    expect(b).not.toHaveProperty('effort');
    expect(b.task).toBe(TASK);
  });

  it('still fails on an unknown role', () => {
    const r = runLw(started(), ['brief', 'wizard']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('usage: effort <');
    expect(r.stdout).toBe('');
  });

  it('falls back to the default config and warns when config.json is corrupt', () => {
    const repo = started();
    writeFileSync(join(repo, '.loopwright/config.json'), '{ not json');
    const r = runLw(repo, ['brief', 'reviewer']);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('config.json unreadable');
    expect(r.stderr).toContain('brief uses the default config');
    const b = JSON.parse(r.stdout);
    expect(b.config.maxFixRounds).toBe(DEFAULT_CONFIG.maxFixRounds);
    expect(b.config.docsDir).toBe(DEFAULT_CONFIG.docsDir);
    expect(b.effort).toBe('xhigh');
  });

  it('falls back to the shipped default, not the user config, when both configs are corrupt', () => {
    const repo = started();
    const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-home-')));
    mkdirSync(join(home, '.config', 'loopwright'), { recursive: true });
    const broken = '{\n  "maxFixRounds": 3,\n}';
    writeFileSync(join(home, '.config', 'loopwright', 'config.json'), broken);
    writeFileSync(join(repo, '.loopwright/config.json'), broken);
    const r = runLw(repo, ['brief', 'reviewer'], undefined, { HOME: home, USERPROFILE: home });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('config.json unreadable');
    const b = JSON.parse(r.stdout);
    expect(b.config.maxFixRounds).toBe(DEFAULT_CONFIG.maxFixRounds);
    expect(b.config.docsDir).toBe(DEFAULT_CONFIG.docsDir);
  });
});
