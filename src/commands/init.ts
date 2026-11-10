import { relative } from 'node:path';
import type { CommandOptions } from '../core/options.js';
import { NotAGitRepoError, resolveTargets, type Targets } from '../core/targets.js';
import { readConfig } from '../core/config.js';
import { readManifest, writeManifest, type Manifest } from '../core/manifest.js';
import { InstallWriter } from '../core/writer.js';
import { installAll, planWiring } from '../install/install.js';
import { planLink } from '../install/symlink.js';
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

export function runInit(opts: CommandOptions): Promise<number> {
  return runInstall(opts, 'installed', true);
}

/** For update: reuse the hook/symlink options recorded in the manifest unless the flag was passed explicitly. */
export function withRecordedOptions(opts: CommandOptions, recorded: Manifest['options']): CommandOptions {
  if (!recorded) return opts;
  return {
    ...opts,
    hook: opts.explicit?.hook ? opts.hook : recorded.hook,
    symlink: opts.explicit?.symlink ? opts.symlink : recorded.symlink,
    experimental: opts.explicit?.experimental ? opts.experimental : (recorded.experimental ?? []),
    profile: opts.explicit?.profile ? opts.profile : recorded.profile,
  };
}

/** Shared install flow for `init` and `update`. */
export async function runInstall(opts: CommandOptions, doneVerb: string, isInit = false): Promise<number> {
  let targets: Targets;
  try {
    targets = resolveTargets(opts);
    if (!isInit) {
      // update (not init): keep the options the install was made with.
      opts = withRecordedOptions(opts, readManifest(targets.manifestPath)?.options);
      targets = resolveTargets(opts);
    }
  } catch (e) {
    if (e instanceof NotAGitRepoError) {
      console.error('loopwright: not a git repository (run inside a repo, or use --global)');
      return 1;
    }
    throw e;
  }
  try {
    planWiring(targets, opts); // pre-flight: abort before writing anything if settings are malformed
    // Pre-flight: resolve the .claude/skills conflict (and any prompt) before writing anything.
    const link =
      targets.claudeSkillsMode === 'symlink'
        ? await planLink({ root: targets.root, dryRun: opts.dryRun, force: opts.force })
        : 'skip';
    if (link === 'abort') {
      console.error('loopwright: aborted; nothing was written.');
      return 1;
    }
    if (targets.mode === 'repo' && targets.stateDir) scaffoldLoopwrightDir(targets.stateDir, opts.dryRun);
    const config = readConfig(targets.configPath, opts.profile);

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
    const changed = await installAll(targets, writer, config, opts, link);
    if (!opts.dryRun)
      writeManifest(targets.manifestPath, {
        ...writer.result(),
        options: {
          hook: opts.hook,
          symlink: opts.symlink,
          ...(opts.experimental?.length ? { experimental: opts.experimental } : {}),
          ...(opts.profile ? { profile: opts.profile } : {}),
        },
      });

    if (!changed) log.success('loopwright is already up to date.');
    else if (!opts.dryRun) log.success(`loopwright ${doneVerb}.`);
    if (targets.mode === 'repo' && opts.hook)
      log.info('Codex: trust this project and approve loopwright hooks via /hooks.');
    log.info('Junie (WIP/EAP): subagents installed to .junie/agents; skills are read from .agents/skills.');
    if (opts.profile)
      log.info(
        `Effort profile: ${opts.profile}. Claude Code can also set it per task at Plan; run \`npx loopwright update\` after changing it.`,
      );
    for (const f of opts.experimental ?? []) {
      log.warn(`Experimental feature "${f}" is unstable and may change or break.`);
      if (f === 'junie-hooks') {
        log.info(
          `Junie hooks are written to ${targets.junieConfigPath}. Junie ignores project hooks unless started with --config-location (e.g. junie --config-location .junie).`,
        );
      }
    }
    return 0;
  } catch (e) {
    if (e instanceof SettingsParseError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
}
