import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, lstatSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
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

describe('global install end to end', () => {
  it('global init → fresh repo → lw.mjs start creates .loopwright/', () => {
    const h = realpathSync(mkdtempSync(join(tmpdir(), 'lw-gh-')));
    const repo = realpathSync(createTempGitRepo('lw-gfresh-'));
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
    expect(runCli(repo, ['init', '--global', '--force'], { home: h }).exitCode).toBe(0);
    expect(existsSync(join(repo, '.loopwright'))).toBe(false);
    const r = spawnSync('node', [join(h, '.config/loopwright/hooks/lw.mjs'), 'start', 'tasks/x.md'], {
      cwd: repo, encoding: 'utf8', env: { ...process.env, HOME: h },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).task).toBe('tasks/x.md');
    expect(readFileSync(join(repo, '.loopwright/.gitignore'), 'utf8')).toBe('*\n');
    expect(existsSync(join(repo, '.loopwright/config.json'))).toBe(true);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })).toBe('');
  });
});

describe('recorded install options', () => {
  it('update reuses --no-hook/--no-symlink from init unless passed explicitly', () => {
    const repo = spacedRepo();
    const home = mkdtempSync(join(tmpdir(), 'lw-h-'));
    expect(runCli(repo, ['init', '--no-hook', '--no-symlink'], { home }).exitCode).toBe(0);
    const r = runCli(repo, ['update'], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(existsSync(join(repo, '.claude/settings.json'))).toBe(false);
    expect(existsSync(join(repo, '.codex/config.toml'))).toBe(false);
    expect(lstatSync(join(repo, '.claude/skills'), { throwIfNoEntry: false })).toBeUndefined();
    expect(readJson(join(repo, '.loopwright/manifest.json')).options).toEqual({ hook: false, symlink: false });
  });

  it('a hooked install keeps its hooks on update', () => {
    const repo = spacedRepo();
    const home = mkdtempSync(join(tmpdir(), 'lw-h-'));
    expect(runCli(repo, ['init'], { home }).exitCode).toBe(0);
    expect(runCli(repo, ['update', '--force'], { home }).exitCode).toBe(0);
    expect(readFileSync(join(repo, '.claude/settings.json'), 'utf8')).toContain('loopwright/hooks/');
    expect(lstatSync(join(repo, '.claude/skills')).isSymbolicLink()).toBe(true);
    expect(readJson(join(repo, '.loopwright/manifest.json')).options).toEqual({ hook: true, symlink: true });
  });
});

describe('hook wiring cleanup', () => {
  const noRef = (repo: string) => {
    for (const f of ['.claude/settings.json', '.codex/config.toml']) {
      const p = join(repo, f);
      if (existsSync(p)) expect(readFileSync(p, 'utf8'), f).not.toContain('loopwright/hooks/');
    }
  };

  it('init → init --no-hook → uninstall leaves no wiring', () => {
    const repo = spacedRepo();
    const home = mkdtempSync(join(tmpdir(), 'lw-h-'));
    expect(runCli(repo, ['init'], { home }).exitCode).toBe(0);
    expect(runCli(repo, ['init', '--no-hook'], { home }).exitCode).toBe(0);
    expect(readJson(join(repo, '.loopwright/manifest.json')).config).toHaveLength(2);
    const r = runCli(repo, ['uninstall'], { home });
    expect(r.exitCode, r.stderr).toBe(0);
    noRef(repo);
  });

  it('uninstall removes wiring from default paths even without manifest config entries', () => {
    const repo = spacedRepo();
    const home = mkdtempSync(join(tmpdir(), 'lw-h-'));
    expect(runCli(repo, ['init'], { home }).exitCode).toBe(0);
    const mp = join(repo, '.loopwright/manifest.json');
    const m = readJson(mp);
    m.config = [];
    writeFileSync(mp, JSON.stringify(m));
    expect(runCli(repo, ['uninstall'], { home }).exitCode).toBe(0);
    noRef(repo);
  });
});
