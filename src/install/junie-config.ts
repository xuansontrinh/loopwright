import type { HookSpec } from './hook-wiring.js';
import { MANAGED_HOOK_HINT } from './hook-wiring.js';
import { mergeClaudeHooks, removeClaudeHooks } from './claude-settings.js';

// Junie's config.json hooks use the same JSON shape as Claude settings.
export function upsertJunieHooks(
  text: string,
  specs: HookSpec[],
  commandFor: (s: HookSpec) => string,
  filePath?: string,
): string {
  return mergeClaudeHooks(text, specs, commandFor, filePath);
}

export function removeJunieHooks(text: string, hint: string = MANAGED_HOOK_HINT, filePath?: string): string {
  return removeClaudeHooks(text, hint, filePath);
}
