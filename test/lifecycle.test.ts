import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, lstatSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createTempGitRepo, readJson, runCli } from './helpers.js';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const SKILL = '.agents/skills/loopwright-flow/SKILL.md';

function spacedRepo(): string {
  const dir = join(createTempGitRepo('lw-lc-'), 'my repo');
  mkdirSync(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

describe('update/uninstall', () => {
  let repo: string;
  let home: string;
  const run = (args: string[], input?: string) => runCli(repo, args, { home, input });
  beforeEach(() => {
    repo = spacedRepo();
    home = mkdtempSync(join(tmpdir(), 'lw-h-'));
    expect(run(['init']).exitCode).toBe(0);
  });

  it('update applies new content', () => {
    const p = join(repo, SKILL);
    const orig = readFileSync(p, 'utf8');
    writeFileSync(p, 'old version\n');
    const mp = join(repo, '.loopwright/manifest.json');
    const m = readJson(mp);
    m.files.find((f: any) => f.path === SKILL).sha256 = sha('old version\n');
    writeFileSync(mp, JSON.stringify(m));
    const r = run(['update']);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(readFileSync(p, 'utf8')).toBe(orig);
  });

  it('keeps user-edited files on update, --force overwrites', () => {
    const p = join(repo, SKILL);
    const orig = readFileSync(p, 'utf8');
    writeFileSync(p, 'mine\n');
    run(['update'], 'n\n');
    expect(readFileSync(p, 'utf8')).toBe('mine\n');
    run(['update', '--force']);
    expect(readFileSync(p, 'utf8')).toBe(orig);
  });

  it('uninstall removes only loopwright files', () => {
    const r = run(['uninstall']);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(existsSync(join(repo, SKILL))).toBe(false);
    expect(readdirSync(join(repo, '.agents'))).toEqual([]);
    expect(readdirSync(join(repo, '.claude'))).toEqual(['settings.json']);
    expect(readdirSync(join(repo, '.codex'))).toEqual(['config.toml']);
    expect(existsSync(join(repo, '.loopwright/manifest.json'))).toBe(false);
  });

  it('preserves user skill dir and user hooks', () => {
    mkdirSync(join(repo, '.agents/skills/mine'), { recursive: true });
    writeFileSync(join(repo, '.agents/skills/mine/SKILL.md'), 'x');
    const sp = join(repo, '.claude/settings.json');
    const s = readJson(sp);
    s.hooks.Stop = [...(s.hooks.Stop ?? []), { hooks: [{ type: 'command', command: 'echo user-stop' }] }];
    writeFileSync(sp, JSON.stringify(s));
    expect(run(['uninstall']).exitCode).toBe(0);
    expect(existsSync(join(repo, '.agents/skills/mine/SKILL.md'))).toBe(true);
    const after = readFileSync(sp, 'utf8');
    expect(after).toContain('user-stop');
    expect(after).not.toContain('loopwright/hooks/');
    expect(lstatSync(join(repo, '.claude/skills'), { throwIfNoEntry: false })).toBeUndefined();
  });

  it('keeps modified files and tasks', () => {
    writeFileSync(join(repo, SKILL), 'edited\n');
    mkdirSync(join(repo, '.loopwright/tasks'), { recursive: true });
    writeFileSync(join(repo, '.loopwright/tasks/x.md'), 'task');
    const r = run(['uninstall']);
    expect(r.stdout).toContain(`kept modified file ${join(repo, SKILL)}`);
    expect(readFileSync(join(repo, SKILL), 'utf8')).toBe('edited\n');
    expect(existsSync(join(repo, '.loopwright/tasks/x.md'))).toBe(true);
  });

  it('no manifest: nothing to uninstall', () => {
    const r = runCli(spacedRepo(), ['uninstall'], { home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('nothing to uninstall (no manifest found)');
  });

  it('--dry-run deletes nothing', () => {
    const r = run(['uninstall', '--dry-run']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Would remove');
    expect(existsSync(join(repo, SKILL))).toBe(true);
    expect(existsSync(join(repo, '.loopwright/manifest.json'))).toBe(true);
    expect(readFileSync(join(repo, '.claude/settings.json'), 'utf8')).toContain('loopwright/hooks/');
  });

  it('global uninstall cleans HOME', () => {
    const h = mkdtempSync(join(tmpdir(), 'lw-gh-'));
    expect(runCli(repo, ['init', '--global', '--force'], { home: h }).exitCode).toBe(0);
    expect(existsSync(join(h, '.config/loopwright/manifest.json'))).toBe(true);
    const declined = runCli(repo, ['uninstall', '--global'], { home: h, input: 'n\n' });
    expect(existsSync(join(h, '.config/loopwright/manifest.json'))).toBe(true);
    expect(declined.exitCode).toBe(0);
    const r = runCli(repo, ['uninstall', '--global', '--force'], { home: h });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(readdirSync(h).filter((n) => n !== '.config' && n !== '.claude' && n !== '.codex' && n !== '.agents')).toEqual([]);
    expect(existsSync(join(h, '.config/loopwright'))).toBe(false);
    expect(existsSync(join(h, '.claude/agents'))).toBe(false);
    expect(existsSync(join(h, '.claude/skills'))).toBe(false);
    expect(existsSync(join(h, '.agents/skills'))).toBe(false);
    expect(readFileSync(join(h, '.claude/settings.json'), 'utf8')).toBe('{}\n');
  });

  it('declined overwrite stays user-owned across update and uninstall', () => {
    const p = join(repo, SKILL);
    writeFileSync(p, 'mine\n');
    run(['update'], 'n\n');
    const r2 = run(['update'], 'n\n');
    expect(r2.stdout + r2.stderr).toContain('was modified');
    expect(readFileSync(p, 'utf8')).toBe('mine\n');
    const u = run(['uninstall']);
    expect(u.stdout).toContain('kept modified file');
    expect(readFileSync(p, 'utf8')).toBe('mine\n');
  });

  it('never deletes a user-created settings.json', () => {
    const r2 = spacedRepo();
    mkdirSync(join(r2, '.claude'));
    writeFileSync(join(r2, '.claude/settings.json'), '{}');
    expect(runCli(r2, ['init'], { home }).exitCode).toBe(0);
    expect(runCli(r2, ['uninstall'], { home }).exitCode).toBe(0);
    expect(readFileSync(join(r2, '.claude/settings.json'), 'utf8')).toBe('{}\n');
  });
});
