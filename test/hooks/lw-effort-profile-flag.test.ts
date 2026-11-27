import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/t.md';

function home(profile?: string): Record<string, string> {
  const h = mkdtempSync(join(tmpdir(), 'lw-home-'));
  if (profile) {
    mkdirSync(join(h, '.config/loopwright'), { recursive: true });
    writeFileSync(join(h, '.config/loopwright/manifest.json'), JSON.stringify({ files: {}, options: { profile } }));
  }
  return { HOME: h, USERPROFILE: h };
}

function repoWithHeader(profileLine?: string): string {
  const repo = makeRepo();
  writeFileSync(
    join(repo, '.loopwright', TASK),
    `# T\n\nstatus: active\nstage: plan\n${profileLine ? profileLine + '\n' : ''}\n## Goal\n\nx\n`,
  );
  expect(runLw(repo, ['start', TASK]).code).toBe(0);
  return repo;
}

const effort = (repo: string, args: string[], env = home()) => runLw(repo, ['effort', ...args], undefined, env);

describe('lw.mjs effort --profile', () => {
  it.each([
    ['lean', 'low'],
    ['balanced', 'medium'],
    ['thorough', 'high'],
    ['deep', 'xhigh'],
  ])('%s gives the scout effort %s with no task and no manifest profile', (name, expected) => {
    const r = effort(makeRepo(), ['scout', '--profile', name]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(expected);
  });

  it('the flag picks the role effort of the named profile', () => {
    expect(effort(makeRepo(), ['reviewer', '--profile', 'thorough']).stdout.trim()).toBe('high');
  });

  it('the flag wins over the task header and the manifest profile', () => {
    const repo = repoWithHeader('profile: deep');
    expect(effort(repo, ['scout', '--profile', 'lean'], home('thorough')).stdout.trim()).toBe('low');
  });

  it('an unknown profile name exits 1 with the unknown-profile message', () => {
    const r = effort(makeRepo(), ['scout', '--profile', 'nope']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown profile 'nope'");
  });
});

describe('lw.mjs effort with a draft header', () => {
  it('profile pending falls through to the manifest profile', () => {
    const r = effort(repoWithHeader('profile: pending'), ['scout'], home('thorough'));
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('high');
  });

  it('profile pending with no manifest profile is balanced', () => {
    const r = effort(repoWithHeader('profile: pending'), ['scout']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('medium');
  });

  it('brief returns an effort and no warning while the profile is pending', () => {
    const r = runLw(repoWithHeader('profile: pending'), ['brief', 'tester'], undefined, home());
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('unknown profile');
    expect(JSON.parse(r.stdout).effort).toBe('medium');
  });
});

describe('lw.mjs effort resolution order without the flag', () => {
  it('a mistyped profile in the header still fails with the unknown-profile message', () => {
    const r = effort(repoWithHeader('profile: thorogh'), ['scout']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown profile 'thorogh'");
  });

  it('the header wins over the manifest profile', () => {
    expect(effort(repoWithHeader('profile: deep'), ['scout'], home('lean')).stdout.trim()).toBe('xhigh');
  });

  it('the manifest profile applies with no header profile', () => {
    expect(effort(repoWithHeader(), ['scout'], home('lean')).stdout.trim()).toBe('low');
  });

  it('no header and no manifest profile is balanced', () => {
    expect(effort(repoWithHeader(), ['scout']).stdout.trim()).toBe('medium');
  });
});
