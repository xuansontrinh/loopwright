import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const PUBLISH = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'publish.yml'), 'utf8');

/** The `run: |` script of the step named `name`. */
function stepScript(name: string): string {
  const lines = PUBLISH.split('\n');
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start < 0) throw new Error(`step not found: ${name}`);
  const runIdx = lines.findIndex((l, i) => i > start && /^\s+run: \|\s*$/.test(l));
  if (runIdx < 0) throw new Error(`no run script in step: ${name}`);
  const indent = /^(\s*)/.exec(lines[runIdx + 1]!)![1]!.length;
  const body: string[] = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.trim() !== '' && !(/^(\s*)/.exec(l)![1]!.length >= indent)) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

interface Setup {
  work: string;
  sha: string;
  other: string;
  origin: string;
  stubs: string;
}

function setup(): Setup {
  const root = mkdtempSync(join(tmpdir(), 'lw-wf-'));
  dirs.push(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  const stubs = join(root, 'stubs');
  mkdirSync(work);
  mkdirSync(stubs);
  git(root, 'init', '--bare', '-q', origin);
  git(work, 'init', '-q');
  git(work, 'config', 'user.email', 't@example.com');
  git(work, 'config', 'user.name', 't');
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'config', 'tag.gpgsign', 'false');
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'loopwright', version: '0.1.5' }));
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'one');
  const other = git(work, 'rev-parse', 'HEAD');
  writeFileSync(join(work, 'a.txt'), 'x');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'two');
  const sha = git(work, 'rev-parse', 'HEAD');
  git(work, 'remote', 'add', 'origin', origin);
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  // npm: version not on npm; gh: no release yet.
  for (const bin of ['npm', 'gh']) {
    writeFileSync(join(stubs, bin), '#!/bin/sh\nexit 1\n');
    chmodSync(join(stubs, bin), 0o755);
  }
  return { work, sha, other, origin, stubs };
}

function runDetect(s: Setup) {
  const out = join(s.work, '..', 'gh-output');
  writeFileSync(out, '');
  const r = spawnSync('bash', ['-e', '-c', stepScript('Detect unreleased version')], {
    cwd: s.work,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${s.stubs}:${process.env.PATH}`, SHA: s.sha, GITHUB_OUTPUT: out, GH_TOKEN: 'x' },
  });
  return { status: r.status, output: readFileSync(out, 'utf8'), stderr: r.stderr + r.stdout };
}

describe('publish.yml tag guard', () => {
  it('AC8: references git ls-remote and the peeled tag in the detect step', () => {
    const script = stepScript('Detect unreleased version');
    expect(script).toContain('ls-remote');
    expect(script).toContain('^{}');
  });

  it('AC8: no remote tag releases normally', () => {
    const r = runDetect(setup());
    expect(r.status).toBe(0);
    expect(r.output).toContain('release=true');
  });

  it('AC8: lightweight remote tag at the release SHA passes', () => {
    const s = setup();
    git(s.work, 'tag', 'v0.1.5', s.sha);
    git(s.work, 'push', '-q', 'origin', 'v0.1.5');
    const r = runDetect(s);
    expect(r.status).toBe(0);
    expect(r.output).toContain('release=true');
  });

  it('AC8: annotated remote tag peeling to the release SHA passes', () => {
    const s = setup();
    git(s.work, 'tag', '-a', 'v0.1.5', '-m', 'v0.1.5', s.sha);
    git(s.work, 'push', '-q', 'origin', 'v0.1.5');
    const r = runDetect(s);
    expect(r.status).toBe(0);
    expect(r.output).toContain('release=true');
  });

  it('AC8: lightweight remote tag at another commit fails', () => {
    const s = setup();
    git(s.work, 'tag', 'v0.1.5', s.other);
    git(s.work, 'push', '-q', 'origin', 'v0.1.5');
    const r = runDetect(s);
    expect(r.status).not.toBe(0);
    expect(r.output).not.toContain('release=true');
  });

  it('AC8: annotated remote tag peeling to another commit fails', () => {
    const s = setup();
    git(s.work, 'tag', '-a', 'v0.1.5', '-m', 'old', s.other);
    git(s.work, 'push', '-q', 'origin', 'v0.1.5');
    const r = runDetect(s);
    expect(r.status).not.toBe(0);
    expect(r.output).not.toContain('release=true');
  });

  it('AC8: fails when git ls-remote fails', () => {
    const s = setup();
    git(s.work, 'remote', 'set-url', 'origin', join(s.work, '..', 'does-not-exist.git'));
    const r = runDetect(s);
    expect(r.status).not.toBe(0);
    expect(r.output).not.toContain('release=true');
  });
});

describe('publish.yml npm pin', () => {
  it('AC9: pins npm@11.15.0 and no longer installs npm@latest', () => {
    expect(PUBLISH).toContain('npm@11.15.0');
    expect(PUBLISH).not.toContain('npm@latest');
  });
});
