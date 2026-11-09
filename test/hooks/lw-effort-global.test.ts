import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRepo, runLw } from './helpers.js';

function fakeHome(profile?: string): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), 'lw-home-'));
  if (profile) {
    mkdirSync(join(home, '.config/loopwright'), { recursive: true });
    writeFileSync(join(home, '.config/loopwright/manifest.json'), JSON.stringify({ files: {}, options: { profile } }));
  }
  return { HOME: home, USERPROFILE: home };
}

describe('lw.mjs effort with a global manifest', () => {
  it('uses the global recorded profile before any task is started', () => {
    const repo = makeRepo();
    const env = fakeHome('deep');
    expect(runLw(repo, ['effort', 'scout'], undefined, env).stdout.trim()).toBe('xhigh');
    expect(runLw(repo, ['effort', 'reviewer'], undefined, env).stdout.trim()).toBe('xhigh');
  });
  it('is balanced with no recorded profile and no task', () => {
    const r = runLw(makeRepo(), ['effort', 'scout'], undefined, fakeHome());
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('medium');
  });
});
