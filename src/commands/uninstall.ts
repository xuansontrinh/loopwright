import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { CommandOptions } from '../core/options.js';
import { NotAGitRepoError, resolveTargets, type Targets } from '../core/targets.js';
import { readManifest, sha256 } from '../core/manifest.js';
import { removeClaudeHooks, SettingsParseError } from '../install/claude-settings.js';
import { removeCodexBlock } from '../install/codex-config.js';
import { confirm } from '../utils/prompt.js';
import { log } from '../utils/log.js';

function pruneEmptyDirs(start: string, stops: Set<string>): void {
  let dir = resolve(start);
  while (!stops.has(dir)) {
    try {
      if (readdirSync(dir).length > 0) return;
      rmdirSync(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

export async function runUninstall(opts: CommandOptions): Promise<number> {
  let targets: Targets;
  try {
    targets = resolveTargets(opts);
  } catch (e) {
    if (e instanceof NotAGitRepoError) {
      console.error('loopwright: not a git repository (run inside a repo, or use --global)');
      return 1;
    }
    throw e;
  }
  const manifest = readManifest(targets.manifestPath);
  if (!manifest) {
    console.log('loopwright: nothing to uninstall (no manifest found)');
    return 0;
  }
  if (targets.mode === 'global' && !opts.dryRun && !opts.force) {
    if (!(await confirm('Remove loopwright from your user configuration?', false))) {
      log.dim('No changes made.');
      return 0;
    }
  }

  const dry = opts.dryRun;
  const would = dry ? 'Would remove' : 'Removed';
  const abs = (k: string): string => (isAbsolute(k) ? k : join(targets.root, k));
  const dirsToPrune = new Set<string>();

  for (const f of manifest.files) {
    const p = abs(f.path);
    if (!existsSync(p)) continue;
    if (sha256(readFileSync(p, 'utf-8')) !== f.sha256) {
      log.warn(`kept modified file ${p}`);
      continue;
    }
    log.dim(`  ${would} ${p}`);
    if (!dry) unlinkSync(p);
    dirsToPrune.add(dirname(p));
  }

  for (const c of manifest.config) {
    if (!existsSync(c.file)) continue;
    const cur = readFileSync(c.file, 'utf-8');
    let out: string;
    try {
      out = c.kind === 'claude-hooks' ? removeClaudeHooks(cur, 'loopwright/hooks/', c.file) : removeCodexBlock(cur);
    } catch (e) {
      if (e instanceof SettingsParseError) {
        log.warn(`left ${c.file} untouched: ${e.message}`);
        continue;
      }
      throw e;
    }
    if (out === cur) continue;
    log.dim(`  ${dry ? 'Would update' : 'Updated'} ${c.file}`);
    if (dry) continue;
    writeFileSync(c.file, c.kind === 'claude-hooks' && out.trim() === '{}' ? '{}\n' : out, 'utf-8');
  }

  const link = targets.claudeSkillsDir;
  if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() && readlinkSync(link) === '../.agents/skills') {
    log.dim(`  ${would} ${link}`);
    if (!dry) {
      unlinkSync(link);
      dirsToPrune.add(dirname(link));
    }
  }

  if (!dry) {
    rmSync(targets.manifestPath, { force: true });
    dirsToPrune.add(dirname(targets.manifestPath));
    const r = targets.root;
    const stops = new Set([r, join(r, '.agents'), join(r, '.claude'), join(r, '.codex'), join(r, '.config')].map((p) => resolve(p)));
    // .loopwright (repo state) is never removed: it holds config/state/tasks.
    if (targets.stateDir) stops.add(resolve(targets.stateDir));
    for (const d of dirsToPrune) pruneEmptyDirs(d, stops);
    log.success('loopwright uninstalled.');
  } else {
    log.dim(`  Would remove ${targets.manifestPath}`);
  }
  return 0;
}
