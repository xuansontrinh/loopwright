import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTempGitRepo, readJson, runCli } from './helpers.js';
import { listContent } from '../src/core/content.js';

const symState = vi.hoisted(() => ({ fail: false }));
vi.mock('node:fs', async (orig) => {
  const actual = await orig<typeof import('node:fs')>();
  return {
    ...actual,
    symlinkSync: (...a: Parameters<typeof actual.symlinkSync>) => {
      if (symState.fail) throw Object.assign(new Error('EPERM: operation not permitted, symlink'), { code: 'EPERM' });
      return actual.symlinkSync(...a);
    },
  };
});

const SKILLS = ['flow', 'plan', 'test', 'build', 'review', 'done'].map((s) => `loopwright-${s}`);
const ROLES = ['scout', 'tester', 'implementer', 'reviewer'];

function spacedRepo(): string {
  const outer = createTempGitRepo('lw-sp-');
  const dir = join(outer, 'my repo');
  mkdirSync(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}
const tmpHome = () => mkdtempSync(join(tmpdir(), 'lw-h-'));

describe('init', () => {
  let repo: string;
  let home: string;
  beforeEach(() => {
    repo = spacedRepo();
    home = tmpHome();
  });
  const init = (args: string[] = [], input?: string) => runCli(repo, ['init', ...args], { home, input });

  it('installs all skills, agents, runtime files and wiring', () => {
    const r = init();
    expect(r.exitCode, r.stderr).toBe(0);
    for (const s of SKILLS) {
      const p = join(repo, '.agents/skills', s, 'SKILL.md');
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, 'utf8')).not.toContain('{{');
    }
    for (const role of ROLES) {
      for (const p of [`.claude/agents/loopwright-${role}.md`, `.codex/agents/loopwright-${role}.toml`]) {
        expect(existsSync(join(repo, p)), p).toBe(true);
        expect(readFileSync(join(repo, p), 'utf8'), p).not.toContain('{{');
      }
    }
    for (const sub of ['skills', 'hooks', 'prompts', 'schemas']) {
      for (const f of listContent(sub)) {
        const dest = sub === 'skills' ? join(repo, '.agents/skills', f) : join(repo, '.agents/loopwright', sub, f);
        expect(existsSync(dest), dest).toBe(true);
      }
    }
    const settings = readJson(join(repo, '.claude/settings.json'));
    expect(JSON.stringify(settings.hooks)).toContain('loopwright/hooks/');
    expect(readFileSync(join(repo, '.codex/config.toml'), 'utf8')).toContain('# BEGIN loopwright');
    expect(existsSync(join(repo, '.loopwright/manifest.json'))).toBe(true);
    expect(r.stdout).toContain('Codex: trust this project and approve loopwright hooks via /hooks.');
  });

  it('.claude/skills is a symlink to ../.agents/skills', () => {
    init();
    const p = join(repo, '.claude/skills');
    expect(lstatSync(p).isSymbolicLink()).toBe(true);
    expect(readlinkSync(p)).toBe('../.agents/skills');
    expect(existsSync(join(p, 'loopwright-flow/SKILL.md'))).toBe(true);
  });

  it('--no-symlink skips the link', () => {
    init(['--no-symlink']);
    expect(existsSync(join(repo, '.claude/skills'))).toBe(false);
    expect(existsSync(join(repo, '.agents/skills/loopwright-flow/SKILL.md'))).toBe(true);
  });

  it('--no-hook writes no wiring', () => {
    init(['--no-hook']);
    expect(existsSync(join(repo, '.claude/settings.json'))).toBe(false);
    expect(existsSync(join(repo, '.codex/config.toml'))).toBe(false);
  });

  it('creates .loopwright with self-ignoring .gitignore and default config', () => {
    init();
    expect(readFileSync(join(repo, '.loopwright/.gitignore'), 'utf8')).toBe('*\n');
    expect(readJson(join(repo, '.loopwright/config.json')).maxFixRounds).toBe(3);
    expect(existsSync(join(repo, '.loopwright/tasks'))).toBe(true);
    expect(existsSync(join(repo, '.loopwright/state'))).toBe(true);
    const st = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
    expect(st).not.toContain('.loopwright');
  });

  it('does not overwrite existing config.json', () => {
    mkdirSync(join(repo, '.loopwright'));
    writeFileSync(join(repo, '.loopwright/config.json'), '{"maxFixRounds":9}\n');
    init();
    expect(readFileSync(join(repo, '.loopwright/config.json'), 'utf8')).toBe('{"maxFixRounds":9}\n');
  });

  it('agents use configured models', () => {
    mkdirSync(join(repo, '.loopwright'));
    writeFileSync(join(repo, '.loopwright/config.json'), '{"models":{"claude":{"reviewer":"sonnet"}}}');
    init();
    expect(readFileSync(join(repo, '.claude/agents/loopwright-reviewer.md'), 'utf8')).toContain('model: sonnet');
  });

  it('is idempotent', () => {
    init();
    const r = init();
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain('already up to date');
  });

  it('--dry-run writes nothing', () => {
    const r = init(['--dry-run']);
    expect(r.exitCode).toBe(0);
    expect(readdirSync(repo).filter((f) => f !== '.git')).toEqual([]);
  });

  it('fails outside a git repo with a clear message', () => {
    const plain = mkdtempSync(join(tmpdir(), 'lw-plain-'));
    const r = runCli(plain, ['init'], { home });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('not a git repository');
  });

  it('aborts wiring on malformed settings.json and leaves it byte-identical', () => {
    mkdirSync(join(repo, '.claude'));
    const bad = '{ not json';
    writeFileSync(join(repo, '.claude/settings.json'), bad);
    const r = init();
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('settings.json');
    expect(readFileSync(join(repo, '.claude/settings.json'), 'utf8')).toBe(bad);
    expect(existsSync(join(repo, '.agents'))).toBe(false);
    expect(existsSync(join(repo, '.loopwright'))).toBe(false);
  });

  it('--global --force installs under HOME', () => {
    const r = init(['--global', '--force']);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(existsSync(join(home, '.agents/skills/loopwright-flow/SKILL.md'))).toBe(true);
    expect(lstatSync(join(home, '.claude/skills')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(home, '.claude/skills/loopwright-flow/SKILL.md'), 'utf8')).not.toContain('{{');
    for (const role of ROLES) {
      expect(existsSync(join(home, `.claude/agents/loopwright-${role}.md`))).toBe(true);
      expect(existsSync(join(home, `.codex/agents/loopwright-${role}.toml`))).toBe(true);
    }
    expect(existsSync(join(home, '.config/loopwright/manifest.json'))).toBe(true);
    expect(existsSync(join(home, '.config/loopwright/config.json'))).toBe(false);
    expect(readFileSync(join(home, '.claude/skills/loopwright-flow/SKILL.md'), 'utf8')).toContain(
      join(home, '.config/loopwright'),
    );
    expect(JSON.stringify(readJson(join(home, '.claude/settings.json')).hooks)).toContain('loopwright/hooks/');
    expect(readdirSync(repo).filter((f) => f !== '.git')).toEqual([]);
  });

  it('--global without --force and declined input writes nothing', () => {
    const r = init(['--global'], 'n\n');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Apply these changes to your user configuration?');
    expect(readdirSync(home)).toEqual([]);
  });

  it('abort at the .claude/skills conflict prompt exits 1 with nothing written', () => {
    mkdirSync(join(repo, '.claude/skills/mine'), { recursive: true });
    writeFileSync(join(repo, '.claude/skills/mine/SKILL.md'), '# mine');
    const r = init([], '4\n');
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('How to handle existing .claude/skills/?');
    expect(existsSync(join(repo, '.agents'))).toBe(false);
    expect(existsSync(join(repo, '.loopwright'))).toBe(false);
    expect(existsSync(join(repo, '.claude/agents'))).toBe(false);
    expect(existsSync(join(repo, '.claude/settings.json'))).toBe(false);
    expect(readFileSync(join(repo, '.claude/skills/mine/SKILL.md'), 'utf8')).toBe('# mine');
  });

  it('skip at the .claude/skills conflict prompt installs everything but the link', () => {
    mkdirSync(join(repo, '.claude/skills/mine'), { recursive: true });
    writeFileSync(join(repo, '.claude/skills/mine/SKILL.md'), '# mine');
    const r = init([], '3\n');
    expect(r.exitCode, r.stderr).toBe(0);
    expect(lstatSync(join(repo, '.claude/skills')).isDirectory()).toBe(true);
    expect(existsSync(join(repo, '.agents/skills/loopwright-flow/SKILL.md'))).toBe(true);
    expect(existsSync(join(repo, '.loopwright/manifest.json'))).toBe(true);
  });
});

describe('AC4: installAll when symlinks are unavailable', () => {
  it('AC4: still writes hooks and manifest', async () => {
    const { runInit } = await import('../src/commands/init.js');
    const { installAll } = await import('../src/install/install.js');
    const { resolveTargets } = await import('../src/core/targets.js');
    const { InstallWriter } = await import('../src/core/writer.js');
    const { DEFAULT_CONFIG } = await import('../src/core/config.js');
    const { relative } = await import('node:path');
    const opts = { mode: 'repo' as const, cwd: '', home: '', dryRun: false, force: true, hook: true, symlink: true };

    const repo1 = createTempGitRepo('lw-ac4a-');
    const targets = resolveTargets({ ...opts, cwd: repo1, home: tmpHome() });
    const writer = new InstallWriter({
      manifest: null,
      dryRun: false,
      force: true,
      confirm: async () => false,
      toKey: (abs: string) => relative(targets.root, abs).split('\\').join('/'),
      mode: 'repo',
    });
    symState.fail = true;
    try {
      await installAll(targets, writer, DEFAULT_CONFIG, { ...opts, cwd: repo1 }, 'create');
    } finally {
      symState.fail = false;
    }
    expect(JSON.stringify(readJson(join(repo1, '.claude/settings.json')).hooks)).toContain('loopwright/hooks/');
    expect(existsSync(join(repo1, '.agents/skills/loopwright-flow/SKILL.md'))).toBe(true);
    expect(writer.result().files.length).toBeGreaterThan(0);
    expect(existsSync(join(repo1, '.claude/skills'))).toBe(false);

    const repo2 = createTempGitRepo('lw-ac4b-');
    symState.fail = true;
    let code: number;
    try {
      code = await runInit({ ...opts, cwd: repo2, home: tmpHome() });
    } finally {
      symState.fail = false;
    }
    expect(code).toBe(0);
    expect(existsSync(join(repo2, '.loopwright/manifest.json'))).toBe(true);
    expect(existsSync(join(repo2, '.claude/settings.json'))).toBe(true);
  });
});
