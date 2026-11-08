import type { HookSpec } from './hook-wiring.js';

export const CODEX_BEGIN = '# BEGIN loopwright';
export const CODEX_END = '# END loopwright';

const BLOCK_RE = /^# BEGIN loopwright[ \t]*\r?\n[\s\S]*?^# END loopwright[ \t]*(?:\r?\n|$)/m;

function tomlString(value: string): string {
  if (!value.includes("'") && !/[\r\n]/.test(value)) return `'${value}'`;
  const esc = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `"${esc}"`;
}

export function renderCodexHookBlock(specs: HookSpec[], commandFor: (s: HookSpec) => string): string {
  const lines = [CODEX_BEGIN];
  for (const s of specs) {
    lines.push(`[[hooks.${s.event}]]`);
    if (s.matcher) lines.push(`matcher = ${tomlString(s.matcher)}`);
    lines.push(`[[hooks.${s.event}.hooks]]`, 'type = "command"', `command = ${tomlString(commandFor(s))}`);
  }
  lines.push(CODEX_END);
  return lines.join('\n') + '\n';
}

export function upsertCodexBlock(text: string, block: string): string {
  const b = block.replace(/\r\n/g, '\n');
  const normalized = b.endsWith('\n') ? b : b + '\n';
  if (BLOCK_RE.test(text)) return text.replace(BLOCK_RE, () => normalized);
  if (text.trim() === '') return normalized;
  const base = text.endsWith('\n') ? text : text + '\n';
  return `${base}\n${normalized}`;
}

function markerRe(begin: string, end: string): RegExp {
  const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${esc(begin)}[ \\t]*\\r?\\n[\\s\\S]*?^${esc(end)}[ \\t]*(?:\\r?\\n|$)`, 'm');
}

export function removeCodexBlock(text: string, markers?: { begin: string; end: string }): string {
  const m = (markers ? markerRe(markers.begin, markers.end) : BLOCK_RE).exec(text);
  if (!m) return text;
  let before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  // Drop the single blank line upsert added in front of the block.
  before = before.replace(/\r?\n(?=\r?\n$)/, '');
  return before + after;
}
