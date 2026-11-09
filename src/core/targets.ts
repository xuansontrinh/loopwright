import { join } from 'node:path';
import type { CommandOptions } from './options.js';
import { gitTopLevel, mainWorktreeRoot } from './git.js';

export class NotAGitRepoError extends Error {
  constructor(cwd: string) {
    super(`Not inside a git repository: ${cwd}`);
    this.name = 'NotAGitRepoError';
  }
}

export interface Targets {
  mode: 'repo' | 'global';
  root: string;
  skillsDir: string;
  claudeSkillsDir: string;
  claudeSkillsMode: 'symlink' | 'copy' | 'none';
  claudeAgentsDir: string;
  codexAgentsDir: string;
  junieAgentsDir: string;
  lwHome: string;
  lwHomeRef: string;
  claudeSettingsPath: string;
  junieConfigPath: string;
  codexConfigPath: string;
  manifestPath: string;
  configPath: string;
  stateDir: string | null;
}

export function resolveTargets(opts: CommandOptions): Targets {
  if (opts.mode === 'global') {
    const h = opts.home;
    const lw = join(h, '.config/loopwright');
    return {
      mode: 'global',
      root: h,
      skillsDir: join(h, '.agents/skills'),
      claudeSkillsDir: join(h, '.claude/skills'),
      claudeSkillsMode: 'copy',
      claudeAgentsDir: join(h, '.claude/agents'),
      codexAgentsDir: join(h, '.codex/agents'),
      junieAgentsDir: join(h, '.junie/agents'),
      lwHome: lw,
      lwHomeRef: lw,
      claudeSettingsPath: join(h, '.claude/settings.json'),
      junieConfigPath: join(h, '.junie/config.json'),
      codexConfigPath: join(h, '.codex/config.toml'),
      manifestPath: join(lw, 'manifest.json'),
      configPath: join(lw, 'config.json'),
      stateDir: null,
    };
  }
  let root: string;
  let main: string;
  try {
    root = gitTopLevel(opts.cwd);
    main = mainWorktreeRoot(opts.cwd);
  } catch {
    throw new NotAGitRepoError(opts.cwd);
  }
  const stateDir = join(main, '.loopwright');
  return {
    mode: 'repo',
    root,
    skillsDir: join(root, '.agents/skills'),
    claudeSkillsDir: join(root, '.claude/skills'),
    claudeSkillsMode: opts.symlink ? 'symlink' : 'none',
    claudeAgentsDir: join(root, '.claude/agents'),
    codexAgentsDir: join(root, '.codex/agents'),
    junieAgentsDir: join(root, '.junie/agents'),
    lwHome: join(root, '.agents/loopwright'),
    lwHomeRef: '.agents/loopwright',
    claudeSettingsPath: join(root, '.claude/settings.json'),
    junieConfigPath: join(root, '.junie/config.json'),
    codexConfigPath: join(root, '.codex/config.toml'),
    manifestPath: join(stateDir, 'manifest.json'),
    configPath: join(stateDir, 'config.json'),
    stateDir,
  };
}
