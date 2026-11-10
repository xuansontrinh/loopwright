import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { sameLinkTarget } from '../src/utils/fs.js';
import { runUninstall } from '../src/commands/uninstall.js';
import { applyLink, SymlinkUnavailableError } from '../src/install/symlink.js';
import { runCli } from './helpers.js';
import { mkdirSync, writeFileSync, existsSync, lstatSync, readlinkSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { linkClaude, detectConflict } from '../src/install/symlink.js';
import { createTempGitRepo } from './helpers.js';

describe('symlink conflict handling', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempGitRepo('lw-link-');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const link = () => linkClaude({ root: tmpDir, dryRun: false, force: true });

  it('detects conflict kinds', () => {
    const p = join(tmpDir, '.claude', 'skills');
    expect(detectConflict(p, '../.agents/skills').kind).toBe('none');
    mkdirSync(p, { recursive: true });
    expect(detectConflict(p, '../.agents/skills').kind).toBe('empty-dir');
  });

  it('handles empty .claude/skills/ directory', async () => {
    mkdirSync(join(tmpDir, '.claude', 'skills'), { recursive: true });
    expect(await link()).toBe(true);
    expect(lstatSync(join(tmpDir, '.claude', 'skills')).isSymbolicLink()).toBe(true);
  });

  it('handles existing correct symlink', async () => {
    mkdirSync(join(tmpDir, '.agents', 'skills'), { recursive: true });
    mkdirSync(join(tmpDir, '.claude'), { recursive: true });
    symlinkSync('../.agents/skills', join(tmpDir, '.claude', 'skills'), 'dir');
    expect(await link()).toBe(false);
    expect(detectConflict(join(tmpDir, '.claude', 'skills'), '../.agents/skills').kind).toBe('correct-symlink');
  });

  it('replaces wrong symlink with force', async () => {
    mkdirSync(join(tmpDir, '.claude'), { recursive: true });
    mkdirSync(join(tmpDir, 'other'), { recursive: true });
    symlinkSync('../other', join(tmpDir, '.claude', 'skills'), 'dir');
    await link();
    expect(sameLinkTarget(readlinkSync(join(tmpDir, '.claude', 'skills')), '../.agents/skills')).toBe(true);
  });

  it('force-merges .claude/skills/ directory with content', async () => {
    const dir = join(tmpDir, '.claude', 'skills', 'my-skill');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '# My Skill');
    await link();
    expect(existsSync(join(tmpDir, '.agents', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
    expect(lstatSync(join(tmpDir, '.claude', 'skills')).isSymbolicLink()).toBe(true);
  });
});

describe('sameLinkTarget', () => {
  it('ignores backslash vs slash only on win32', () => {
    expect(sameLinkTarget('..\\.agents\\skills', '../.agents/skills', 'win32')).toBe(true);
    expect(sameLinkTarget('..\\.agents\\skills', '../.agents/skills', 'linux')).toBe(false);
    expect(sameLinkTarget('../.agents/skills', '../.agents/skills', 'linux')).toBe(true);
    expect(sameLinkTarget('../.agents/skills', '../.agents/skills', 'win32')).toBe(true);
  });

  it('rejects null and different targets', () => {
    expect(sameLinkTarget(null, '../.agents/skills', 'win32')).toBe(false);
    expect(sameLinkTarget(null, '../.agents/skills', 'linux')).toBe(false);
    expect(sameLinkTarget('..\\other', '../.agents/skills', 'win32')).toBe(false);
  });
});

describe('merge keeps differing skills', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = createTempGitRepo('lw-merge-');
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
  const skill = (area: string, name: string, text: string) => {
    mkdirSync(join(tmpDir, area, 'skills', name), { recursive: true });
    writeFileSync(join(tmpDir, area, 'skills', name, 'SKILL.md'), text);
  };
  const link = () => linkClaude({ root: tmpDir, dryRun: false, force: true });

  it('a differing skill keeps .claude/skills and skips the symlink', async () => {
    skill('.agents', 'foo', 'agents version');
    skill('.claude', 'foo', 'claude version');
    await link();
    expect(lstatSync(join(tmpDir, '.claude', 'skills')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(tmpDir, '.claude', 'skills', 'foo', 'SKILL.md'), 'utf8')).toBe('claude version');
    expect(readFileSync(join(tmpDir, '.agents', 'skills', 'foo', 'SKILL.md'), 'utf8')).toBe('agents version');
  });

  it('identical skills merge and the symlink is created', async () => {
    skill('.agents', 'foo', 'same');
    skill('.claude', 'foo', 'same');
    await link();
    expect(lstatSync(join(tmpDir, '.claude', 'skills')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(tmpDir, '.agents', 'skills', 'foo', 'SKILL.md'), 'utf8')).toBe('same');
  });

  it('a dangling symlink at the destination is a conflict', async () => {
    skill('.claude', 'foo', 'claude version');
    mkdirSync(join(tmpDir, '.agents', 'skills'), { recursive: true });
    symlinkSync(join(tmpDir, 'nowhere'), join(tmpDir, '.agents', 'skills', 'foo'));
    await link();
    expect(lstatSync(join(tmpDir, '.claude', 'skills')).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(tmpDir, '.agents', 'skills', 'foo')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(tmpDir, '.claude', 'skills', 'foo', 'SKILL.md'))).toBe(true);
  });
});

describe('applyLink when symlinks are unavailable', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = createTempGitRepo('lw-unavail-');
  });
  afterEach(() => {
    try {
      chmodSync(join(tmpDir, '.claude'), 0o755);
    } catch {
      /* ignore */
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });
  const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0;

  it.skipIf(!canChmod)('throws SymlinkUnavailableError before deleting anything', () => {
    const dir = join(tmpDir, '.claude', 'skills', 'mine');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), 'keep me');
    chmodSync(join(tmpDir, '.claude'), 0o555);
    for (const action of ['replace', 'merge'] as const) {
      expect(() => applyLink(tmpDir, action, false), action).toThrow(SymlinkUnavailableError);
      expect(readFileSync(join(dir, 'SKILL.md'), 'utf8'), action).toBe('keep me');
    }
  });
});

describe('uninstall with backslash link target', () => {
  it('removes a link whose target uses backslashes on win32', async () => {
    const repo = createTempGitRepo('lw-un-');
    const home = mkdtempSync(join(tmpdir(), 'lw-unh-'));
    const r = runCli(repo, ['init'], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    const p = join(repo, '.claude', 'skills');
    rmSync(p, { recursive: true, force: true });
    symlinkSync('..\\.agents\\skills', p, 'dir');
    const orig = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const code = await runUninstall({
        mode: 'repo',
        cwd: repo,
        home,
        dryRun: false,
        force: true,
        hook: true,
        symlink: true,
      });
      expect(code).toBe(0);
    } finally {
      Object.defineProperty(process, 'platform', orig);
    }
    expect(lstatSync(p, { throwIfNoEntry: false })).toBeUndefined();
  });
});
