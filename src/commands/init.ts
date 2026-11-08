import { relative } from 'node:path';
import type { CommandOptions } from '../core/options.js';
import { NotAGitRepoError, resolveTargets, type Targets } from '../core/targets.js';
import { readConfig } from '../core/config.js';
import { readManifest, writeManifest } from '../core/manifest.js';
import { InstallWriter } from '../core/writer.js';
import { installAll } from '../install/install.js';
import { scaffoldLoopwrightDir } from '../install/loopwright-dir.js';
import { SettingsParseError } from '../install/claude-settings.js';
import { confirm } from '../utils/prompt.js';
import { log } from '../utils/log.js';

function makeWriter(targets: Targets, opts: CommandOptions): InstallWriter {
  return new InstallWriter({
    manifest: targets.manifestPath ? readManifest(targets.manifestPath) : null,
    dryRun: opts.dryRun,
    force: opts.force,
    confirm: (q) => confirm(q, false),
    toKey: (abs) => (targets.mode === 'repo' ? relative(targets.root, abs).split('\\').join('/') : abs),
    mode: targets.mode,
  });
}

export async function runInit(opts: CommandOptions): Promise<number> {
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
  try {
    if (targets.mode === 'repo' && targets.stateDir) scaffoldLoopwrightDir(targets.stateDir, opts.dryRun);
    const config = readConfig(targets.configPath);

    if (targets.mode === 'global' && !opts.dryRun && !opts.force) {
      log.info('The following changes would be made to your user configuration:');
      const preview = { ...opts, dryRun: true };
      const any = await installAll(targets, makeWriter(targets, preview), config, preview);
      if (!any) log.dim('  (no changes)');
      if (!(await confirm('Apply these changes to your user configuration?', false))) {
        log.dim('No changes made.');
        return 0;
      }
    }

    const writer = makeWriter(targets, opts);
    const changed = await installAll(targets, writer, config, opts);
    if (!opts.dryRun) writeManifest(targets.manifestPath, writer.result());

    if (!changed) log.success('loopwright is already up to date.');
    else if (!opts.dryRun) log.success('loopwright installed.');
    if (targets.mode === 'repo' && opts.hook) log.info('Codex: trust this project and approve loopwright hooks via /hooks.');
    return 0;
  } catch (e) {
    if (e instanceof SettingsParseError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
}
