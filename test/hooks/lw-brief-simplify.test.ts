import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/t.md';
const withoutSimplify = {
  maxFixRounds: 3,
  crossAgentReview: 'off',
  docsDir: 'docs/agents',
  models: DEFAULT_CONFIG.models,
};

/** A repo with a started task; `config` replaces the config.json the start scaffolds. */
function started(config?: Record<string, unknown>): string {
  const repo = makeRepo();
  writeFileSync(
    join(repo, '.loopwright', TASK),
    '# T\n\nstatus: active\nstage: plan\nprofile: thorough\n\n## Goal\n\nx\n',
  );
  expect(runLw(repo, ['start', TASK]).code).toBe(0);
  if (config) writeFileSync(join(repo, '.loopwright/config.json'), JSON.stringify(config));
  return repo;
}

const simplifyOf = (repo: string) => JSON.parse(runLw(repo, ['brief', 'reviewer']).stdout).config.simplify;

describe('lw.mjs brief simplify', () => {
  it('is true when config.json has no simplify key', () => {
    expect(simplifyOf(started(withoutSimplify))).toBe(true);
  });

  it('is false when config.json sets it to false', () => {
    expect(simplifyOf(started({ ...withoutSimplify, simplify: false }))).toBe(false);
  });

  it('is true when config.json sets it to true', () => {
    expect(simplifyOf(started({ ...withoutSimplify, simplify: true }))).toBe(true);
  });

  it('is true in the config a fresh task start scaffolds', () => {
    expect(simplifyOf(started())).toBe(true);
  });
});
