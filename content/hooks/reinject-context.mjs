#!/usr/bin/env node
// SessionStart(compact) hook: re-inject the active task summary after context compaction.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allow, failOpen, loopwrightDir, readState, readStdinJson, worktreeId } from './lib.mjs';

const NEXT = {
  plan: 'Continue /loopwright-plan: finish the assumption ledger and confirm the tier.',
  test: 'Continue /loopwright-test.',
  build: 'Continue /loopwright-build; locked tests must not be edited.',
  review: 'Continue /loopwright-review.',
  done: 'Run /loopwright-done.',
};

function goalParagraph(text) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^#{1,6}\s*goal\b/i.test(l.trim()));
  if (i === -1) return [];
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (/^#{1,6}\s/.test(l)) break;
    if (l.trim() === '') {
      if (out.length) break;
      continue;
    }
    out.push(l);
  }
  return out;
}

try {
  const tool = process.argv.includes('--tool') ? process.argv[process.argv.indexOf('--tool') + 1] : 'claude';
  const input = await readStdinJson();
  const cwd = input.cwd || process.cwd();
  const dir = loopwrightDir(cwd);
  if (!dir) allow();
  const state = readState(dir, worktreeId(cwd));
  if (!state) allow();

  const lines = [`loopwright: active task ${state.task}`];
  const file = join(dir, String(state.task));
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    lines.push(...goalParagraph(text));
    lines.push(`Stage: ${state.stage}`);
    lines.push(...text.split('\n').filter((l) => l.startsWith('- D')));
  } else {
    lines.push(`Stage: ${state.stage}`);
  }
  lines.push(NEXT[state.stage] ?? NEXT.plan);
  const body = lines.slice(0, 40);
  if (lines.length > 40) body[39] = lines[lines.length - 1];
  const out = body.join('\n');

  if (tool === 'codex') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: out } }) + '\n');
  } else {
    process.stdout.write(out + '\n');
  }
  allow();
} catch (err) {
  failOpen(err);
}
