import type { HookSpec } from './hook-wiring.js';
import { MANAGED_HOOK_HINT } from './hook-wiring.js';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };

export class SettingsParseError extends Error {
  constructor(message: string, filePath?: string) {
    super(filePath ? `Could not parse ${filePath}: ${message}` : `Could not parse settings: ${message}`);
    this.name = 'SettingsParseError';
  }
}

const isObj = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseObject(text: string, filePath?: string): JsonObject {
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new SettingsParseError(e instanceof Error ? e.message : String(e), filePath);
  }
  if (!isObj(parsed)) throw new SettingsParseError('expected a JSON object at the top level', filePath);
  return parsed;
}

function isManagedGroup(group: Json, hint: string): boolean {
  if (!isObj(group) || !Array.isArray(group['hooks']) || group['hooks'].length === 0) return false;
  return group['hooks'].every(
    (h) => isObj(h) && typeof h['command'] === 'string' && h['command'].includes(hint),
  );
}

function hooksOf(obj: JsonObject, filePath?: string): JsonObject | undefined {
  const h = obj['hooks'];
  if (h === undefined) return undefined;
  if (!isObj(h)) throw new SettingsParseError('expected "hooks" to be a JSON object', filePath);
  return h;
}

export function mergeClaudeHooks(
  settingsText: string,
  specs: HookSpec[],
  commandFor: (s: HookSpec) => string,
  filePath?: string,
): string {
  const settings = parseObject(settingsText, filePath);
  const hooks: JsonObject = { ...(hooksOf(settings, filePath) ?? {}) };
  // Drop our previous groups for every event we touch, then append fresh ones.
  const events = [...new Set(specs.map((s) => s.event))];
  for (const ev of events) {
    const cur = hooks[ev];
    if (cur !== undefined && !Array.isArray(cur)) {
      throw new SettingsParseError(`expected hooks.${ev} to be an array`, filePath);
    }
    hooks[ev] = (cur ?? []).filter((g) => !isManagedGroup(g, MANAGED_HOOK_HINT));
  }
  for (const s of specs) {
    const group: JsonObject = {};
    if (s.matcher) group['matcher'] = s.matcher;
    group['hooks'] = [{ type: 'command', command: commandFor(s) }];
    (hooks[s.event] as Json[]).push(group);
  }
  return JSON.stringify({ ...settings, hooks }, null, 2) + '\n';
}

export function removeClaudeHooks(settingsText: string, hint: string, filePath?: string): string {
  const settings = parseObject(settingsText, filePath);
  const hooksIn = hooksOf(settings, filePath);
  if (!hooksIn) return settingsText;
  const hooks: JsonObject = { ...hooksIn };
  let touched = false;
  for (const [ev, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups.filter((g) => !isManagedGroup(g, hint));
    if (kept.length === groups.length) continue;
    touched = true;
    if (kept.length === 0) delete hooks[ev];
    else hooks[ev] = kept;
  }
  if (!touched) return settingsText;
  const next: JsonObject = { ...settings };
  if (Object.keys(hooks).length === 0) delete next['hooks'];
  else next['hooks'] = hooks;
  return JSON.stringify(next, null, 2) + '\n';
}
