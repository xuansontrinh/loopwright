import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { CommandOptions } from '../core/options.js';
import type { Targets } from '../core/targets.js';
import type { LoopwrightConfig, Role } from '../core/config.js';
import type { InstallWriter } from '../core/writer.js';
import { listContent, readContent, renderTemplate } from '../core/content.js';
import { parseAgentSource, renderClaudeAgent, renderCodexAgent, renderJunieAgent } from '../generate/agents.js';
import { hookCommand, hookSpecs } from './hook-wiring.js';
import { mergeClaudeHooks } from './claude-settings.js';
import { removeJunieHooks, upsertJunieHooks } from './junie-config.js';
import { MANAGED_HOOK_HINT } from './hook-wiring.js';
import { renderCodexHookBlock, upsertCodexBlock } from './codex-config.js';
import { applyLink, SymlinkUnavailableError, type LinkAction } from './symlink.js';
import { log } from '../utils/log.js';

export interface WiringPlan {
  file: string;
  kind: 'claude-hooks' | 'codex-block' | 'junie-hooks';
  /** False when the feature is off and the plan only strips a previously managed block. */
  managed: boolean;
  cur: string;
  out: string;
}

/** Compute hook wiring results without writing. Throws SettingsParseError on malformed files. */
export function planWiring(targets: Targets, opts: CommandOptions): WiringPlan[] {
  const read = (f: string): string => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  const plans: WiringPlan[] = [];
  if (opts.hook) {
    const cs = read(targets.claudeSettingsPath);
    const cc = read(targets.codexConfigPath);
    plans.push(
      {
        file: targets.claudeSettingsPath,
        kind: 'claude-hooks',
        managed: true,
        cur: cs,
        out: mergeClaudeHooks(
          cs,
          hookSpecs('claude'),
          (s) => hookCommand('claude', targets, s.script),
          targets.claudeSettingsPath,
        ),
      },
      {
        file: targets.codexConfigPath,
        kind: 'codex-block',
        managed: true,
        cur: cc,
        out: upsertCodexBlock(
          cc,
          renderCodexHookBlock(hookSpecs('codex'), (s) => hookCommand('codex', targets, s.script)),
        ),
      },
    );
  }
  const jc = read(targets.junieConfigPath);
  if (opts.experimental?.includes('junie-hooks')) {
    plans.push({
      file: targets.junieConfigPath,
      kind: 'junie-hooks',
      managed: true,
      cur: jc,
      out: upsertJunieHooks(
        jc,
        hookSpecs('junie'),
        (s) => hookCommand('junie', targets, s.script),
        targets.junieConfigPath,
      ),
    });
  } else if (jc.includes(MANAGED_HOOK_HINT)) {
    // Feature dropped: strip the block we wrote earlier.
    plans.push({
      file: targets.junieConfigPath,
      kind: 'junie-hooks',
      managed: false,
      cur: jc,
      out: removeJunieHooks(jc, MANAGED_HOOK_HINT, targets.junieConfigPath),
    });
  }
  return plans;
}

/** Install every file under content/ plus agents and hook wiring. Returns whether anything changed. */
export async function installAll(
  targets: Targets,
  writer: InstallWriter,
  config: LoopwrightConfig,
  opts: CommandOptions,
  link: LinkAction = 'skip',
): Promise<boolean> {
  const wiring = planWiring(targets, opts);
  let changed = false;
  const vars = { LW_HOME: targets.lwHomeRef };

  const put = async (abs: string, content: string): Promise<void> => {
    const outcome = await writer.writeFile(abs, content);
    if (outcome === 'created' || outcome === 'updated') {
      changed = true;
      log.dim(`  ${opts.dryRun ? 'Would ' : ''}${outcome === 'created' ? 'create' : 'update'} ${abs}`);
    } else if (outcome === 'kept') {
      log.warn(`Kept your modified ${abs}`);
    }
  };

  for (const f of listContent('skills')) {
    const text = renderTemplate(readContent(`skills/${f}`), vars);
    await put(join(targets.skillsDir, f), text);
    if (targets.claudeSkillsMode === 'copy') await put(join(targets.claudeSkillsDir, f), text);
  }

  for (const f of listContent('agents')) {
    if (!f.endsWith('.md')) continue;
    const role = basename(f, '.md') as Role;
    const src = parseAgentSource(role, renderTemplate(readContent(`agents/${f}`), vars));
    await put(
      join(targets.claudeAgentsDir, `${src.name}.md`),
      renderClaudeAgent(src, config.models.claude[role] ?? 'inherit', config.models.claude.effort?.[role]),
    );
    await put(
      join(targets.codexAgentsDir, `${src.name}.toml`),
      renderCodexAgent(src, config.models.codex[role] ?? 'inherit', config.models.codex.effort?.[role]),
    );
    await put(
      join(targets.junieAgentsDir, `${src.name}.md`),
      renderJunieAgent(
        src,
        config.models.junie[role] ?? 'inherit',
        config.models.junie.effort?.[role],
        targets.lwHomeRef,
      ),
    );
  }

  for (const sub of ['hooks', 'prompts', 'schemas']) {
    for (const f of listContent(sub)) {
      const raw = readContent(`${sub}/${f}`);
      await put(join(targets.lwHome, sub, f), sub === 'hooks' ? raw : renderTemplate(raw, vars));
    }
  }

  if (targets.claudeSkillsMode === 'symlink') {
    try {
      if (applyLink(targets.root, link, opts.dryRun)) changed = true;
    } catch (e) {
      if (!(e instanceof SymlinkUnavailableError)) throw e;
      log.warn(`${e.message}; leaving .claude/skills as-is (enable Developer Mode or run elevated on Windows)`);
    }
  }

  if (!opts.hook) writer.carryPriorConfig(['claude-hooks', 'codex-block']);
  for (const w of wiring) {
    if (w.managed) writer.recordConfig({ file: w.file, kind: w.kind });
    if (w.out === w.cur) continue;
    changed = true;
    log.dim(`  ${opts.dryRun ? 'Would update' : 'Updated'} ${w.file}`);
    if (opts.dryRun) continue;
    mkdirSync(dirname(w.file), { recursive: true });
    writeFileSync(w.file, w.out, 'utf8');
  }
  return changed;
}
