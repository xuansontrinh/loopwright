import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeClaudeHooks } from './claude-settings.js';
import { removeCodexBlock } from './codex-config.js';

export interface LegacyArtifact {
  description: string;
  apply: () => void;
}

const LEGACY_SKILLS = ['spec-create', 'spec-update', 'spec-complete', 'spec-handoff', 'ide-mcp'];
const LEGACY_HOOK = 'ide-mcp-context.mjs';
const OLD_MARKERS = { begin: '# BEGIN coding-agents-toolings ide-mcp', end: '# END coding-agents-toolings ide-mcp' };

/** Find files and config entries written by the old coding-agents-toolings installer (repo mode). */
export function detectLegacy(root: string): LegacyArtifact[] {
  return scanLegacy(root).artifacts;
}

export function scanLegacy(root: string): { artifacts: LegacyArtifact[]; warnings: string[] } {
  const found: LegacyArtifact[] = [];
  const warnings: string[] = [];

  for (const name of LEGACY_SKILLS) {
    const rel = `.agents/skills/${name}`;
    const dir = join(root, rel);
    if (!existsSync(dir)) continue;
    let extra = false;
    try {
      extra = readdirSync(dir).some((f) => f !== 'SKILL.md');
    } catch {
      continue; // not a directory
    }
    found.push({
      description: extra ? `${rel} (contains extra files)` : rel,
      apply: () => rmSync(dir, { recursive: true, force: true }),
    });
  }

  let codexAfter = '';
  let claudeAfter = '';
  const codex = join(root, '.codex/config.toml');
  if (existsSync(codex)) {
    const text = readFileSync(codex, 'utf8');
    const next = removeCodexBlock(text, OLD_MARKERS);
    codexAfter = next;
    if (next !== text) {
      found.push({
        description: 'coding-agents-toolings block in .codex/config.toml',
        apply: () => writeFileSync(codex, next),
      });
    }
  }

  const settings = join(root, '.claude/settings.json');
  if (existsSync(settings)) {
    const text = readFileSync(settings, 'utf8');
    const next = removeClaudeHooks(text, LEGACY_HOOK, settings);
    claudeAfter = next;
    if (next !== text) {
      found.push({
        description: 'ide-mcp hook entries in .claude/settings.json',
        apply: () => writeFileSync(settings, next),
      });
    }
  }

  for (const [dir, after, cfg] of [
    ['.codex', codexAfter, '.codex/config.toml'],
    ['.claude', claudeAfter, '.claude/settings.json'],
  ] as const) {
    const rel = `${dir}/hooks/${LEGACY_HOOK}`;
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    if (after.includes(LEGACY_HOOK)) {
      warnings.push(`loopwright: manual cleanup needed: ${cfg} still references ${LEGACY_HOOK}`);
    } else {
      found.push({ description: rel, apply: () => rmSync(p, { force: true }) });
    }
  }

  return { artifacts: found, warnings };
}
