import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { CommandOptions } from '../core/options.js';
import type { Targets } from '../core/targets.js';
import type { LoopwrightConfig, Role } from '../core/config.js';
import type { InstallWriter } from '../core/writer.js';
import { listContent, readContent, renderTemplate } from '../core/content.js';
import { parseAgentSource, renderClaudeAgent, renderCodexAgent } from '../generate/agents.js';
import { hookCommand, hookSpecs } from './hook-wiring.js';
import { mergeClaudeHooks } from './claude-settings.js';
import { renderCodexHookBlock, upsertCodexBlock } from './codex-config.js';
import { linkClaude } from './symlink.js';
import { log } from '../utils/log.js';

/** Install every file under content/ plus agents and hook wiring. Returns whether anything changed. */
export async function installAll(
  targets: Targets,
  writer: InstallWriter,
  config: LoopwrightConfig,
  opts: CommandOptions,
): Promise<boolean> {
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
    const src = parseAgentSource(role, readContent(`agents/${f}`));
    await put(join(targets.claudeAgentsDir, `${src.name}.md`), renderClaudeAgent(src, config.models.claude[role] ?? 'inherit'));
    await put(
      join(targets.codexAgentsDir, `${src.name}.toml`),
      renderCodexAgent(src, config.models.codex[role] ?? 'inherit', config.models.codex.effort?.[role]),
    );
  }

  for (const sub of ['hooks', 'prompts', 'schemas']) {
    for (const f of listContent(sub)) {
      const raw = readContent(`${sub}/${f}`);
      await put(join(targets.lwHome, sub, f), sub === 'hooks' ? raw : renderTemplate(raw, vars));
    }
  }

  if (targets.claudeSkillsMode === 'symlink') {
    if (await linkClaude({ root: targets.root, dryRun: opts.dryRun, force: opts.force })) changed = true;
  }

  if (opts.hook) {
    const wire = (file: string, kind: 'claude-hooks' | 'codex-block', next: (text: string) => string): void => {
      const cur = existsSync(file) ? readFileSync(file, 'utf8') : '';
      const out = next(cur);
      writer.recordConfig({ file, kind });
      if (out === cur) return;
      changed = true;
      log.dim(`  ${opts.dryRun ? 'Would update' : 'Updated'} ${file}`);
      if (opts.dryRun) return;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, out, 'utf8');
    };
    wire(targets.claudeSettingsPath, 'claude-hooks', (t) =>
      mergeClaudeHooks(t, hookSpecs('claude'), (s) => hookCommand('claude', targets, s.script), targets.claudeSettingsPath),
    );
    wire(targets.codexConfigPath, 'codex-block', (t) =>
      upsertCodexBlock(t, renderCodexHookBlock(hookSpecs('codex'), (s) => hookCommand('codex', targets, s.script))),
    );
  }
  return changed;
}
