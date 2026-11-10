import { describe, it, expect } from 'vitest';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTempGitRepo } from './helpers.js';
import { resolveTargets, NotAGitRepoError } from '../src/core/targets.js';
import { mainWorktreeRoot } from '../src/core/git.js';
import { renderTemplate, listContent, contentRoot } from '../src/core/content.js';
import type { CommandOptions } from '../src/core/options.js';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();
const opts = (o: Partial<CommandOptions>): CommandOptions => ({
  mode: 'repo',
  cwd: '/',
  home: '/h',
  dryRun: false,
  force: false,
  hook: false,
  symlink: true,
  ...o,
});

describe('targets', () => {
  it('repo targets', () => {
    const repo = realpathSync(createTempGitRepo());
    const t = resolveTargets(opts({ cwd: repo }));
    expect(t.root).toBe(repo);
    expect(t.skillsDir).toBe(join(repo, '.agents/skills'));
    expect(t.claudeSkillsDir).toBe(join(repo, '.claude/skills'));
    expect(t.claudeSkillsMode).toBe('symlink');
    expect(t.claudeAgentsDir).toBe(join(repo, '.claude/agents'));
    expect(t.codexAgentsDir).toBe(join(repo, '.codex/agents'));
    expect(t.lwHome).toBe(join(repo, '.agents/loopwright'));
    expect(t.lwHomeRef).toBe('.agents/loopwright');
    expect(t.claudeSettingsPath).toBe(join(repo, '.claude/settings.json'));
    expect(t.codexConfigPath).toBe(join(repo, '.codex/config.toml'));
    expect(t.manifestPath).toBe(join(repo, '.loopwright/manifest.json'));
    expect(t.configPath).toBe(join(repo, '.loopwright/config.json'));
    expect(t.stateDir).toBe(join(repo, '.loopwright'));
    expect(resolveTargets(opts({ cwd: repo, symlink: false })).claudeSkillsMode).toBe('none');
  });

  it('global targets', () => {
    const home = '/home/u';
    const t = resolveTargets(opts({ mode: 'global', home, cwd: '/nowhere' }));
    expect(t.root).toBe(home);
    expect(t.skillsDir).toBe(join(home, '.agents/skills'));
    expect(t.claudeSkillsDir).toBe(join(home, '.claude/skills'));
    expect(t.claudeSkillsMode).toBe('copy');
    expect(t.claudeAgentsDir).toBe(join(home, '.claude/agents'));
    expect(t.codexAgentsDir).toBe(join(home, '.codex/agents'));
    expect(t.lwHome).toBe(join(home, '.config/loopwright'));
    expect(t.lwHomeRef).toBe(join(home, '.config/loopwright'));
    expect(t.manifestPath).toBe(join(home, '.config/loopwright/manifest.json'));
    expect(t.configPath).toBe(join(home, '.config/loopwright/config.json'));
    expect(t.claudeSettingsPath).toBe(join(home, '.claude/settings.json'));
    expect(t.codexConfigPath).toBe(join(home, '.codex/config.toml'));
    expect(t.stateDir).toBeNull();
  });

  it('main worktree from secondary worktree', () => {
    const repo = realpathSync(createTempGitRepo());
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init');
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'lw-wt-'))), 'wt');
    git(repo, 'worktree', 'add', wt, '-b', 'feat');
    expect(mainWorktreeRoot(wt)).toBe(repo);
    const t = resolveTargets(opts({ cwd: wt }));
    expect(t.root).toBe(wt);
    expect(t.stateDir).toBe(join(repo, '.loopwright'));
    expect(t.manifestPath).toBe(join(repo, '.loopwright/manifest.json'));
  });

  it('bare repo fallback', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lw-bare-')));
    git(dir, 'init', '--bare');
    // common dir is not named .git: falls back to show-toplevel, which fails in a bare repo
    expect(() => mainWorktreeRoot(dir)).toThrow();
  });

  it('bare repo linked worktree falls back to its own top-level', () => {
    const repo = realpathSync(createTempGitRepo());
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init');
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'lw-bw-')));
    const bare = join(base, 'b.git');
    git(base, 'clone', '--bare', repo, bare);
    const wt = join(base, 'wt');
    git(bare, 'worktree', 'add', wt, 'HEAD', '--detach');
    expect(realpathSync(mainWorktreeRoot(wt))).toBe(realpathSync(wt));
    const t = resolveTargets(opts({ cwd: wt }));
    expect(t.stateDir).toBe(join(realpathSync(wt), '.loopwright'));
  });

  it('renderTemplate replaces and rejects unknown placeholders', () => {
    expect(renderTemplate('a {{X}} b {{X}} {{Y}}', { X: '1', Y: '2' })).toBe('a 1 b 1 2');
    expect(() => renderTemplate('{{NOPE}}', {})).toThrow(/NOPE/);
  });

  it('listContent lists sorted relative paths', () => {
    const d = mkdtempSync(join(tmpdir(), 'lw-c-'));
    mkdirSync(join(d, 'skills/b'), { recursive: true });
    writeFileSync(join(d, 'skills/b/SKILL.md'), 'x');
    writeFileSync(join(d, 'skills/a.md'), 'x');
    expect(listContent('skills', d)).toEqual(['a.md', 'b/SKILL.md']);
    expect(listContent('missing', d)).toEqual([]);
    expect(basename(contentRoot().replace(/\/$/, ''))).toBe('content');
  });

  it('repo mode outside git throws NotAGitRepoError', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lw-nogit-')));
    expect(() => resolveTargets(opts({ cwd: dir }))).toThrow(NotAGitRepoError);
  });
});
