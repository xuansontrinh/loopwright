import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    expect(readlinkSync(join(tmpDir, '.claude', 'skills'))).toBe('../.agents/skills');
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
