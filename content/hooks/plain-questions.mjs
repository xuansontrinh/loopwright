#!/usr/bin/env node
// PreToolUse hook (Claude Code only): send an AskUserQuestion back for a rewrite when it holds a bare loopwright label.
// https://code.claude.com/docs/en/hooks.md (PreToolUse): tool_input.questions[] has question, header, options[].label and .description; exit 2 sends stderr to Claude.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  USER_MESSAGES_RULES,
  allow,
  deny,
  exitIfHooksOff,
  failOpen,
  loopwrightDir,
  readState,
  readStdinJson,
  worktreeId,
  writeState,
} from './lib.mjs';

// Two denials in a row, then the question goes through, so a stubborn one never loops.
const CAP = 2;
// Words only loopwright uses; common words with a loopwright meaning (tier, slice, lock) are left to the rules file.
// The closing \b keeps everyday words out ("fix rounding", "two passwords", "stop gateway").
const PHRASES = /\b(?:stop[- ]gates?|re-?lock(?:s|ed|ing)?|fix[- ]rounds?|two[- ]pass|acceptance criteri(?:a|on))\b/gi;
// Text after a plain description: in brackets, parentheses or backticks.
const LABELLED = /\([^)]*\)|\[[^\]]*\]|`[^`]*`/g;

exitIfHooksOff();

try {
  // Unreadable input is not this hook's to report.
  const input = await readStdinJson().catch(() => allow());
  if (input.tool_name !== 'AskUserQuestion') allow();
  const cwd = input.cwd || process.cwd();
  const dir = loopwrightDir(cwd);
  if (!dir) allow();
  const id = worktreeId(cwd);
  const state = readState(dir, id);
  if (!state?.task) allow();

  // Only ids this task file defines, so `S3` in a question about Amazon S3 passes.
  const defined = [...readFileSync(join(dir, state.task), 'utf8').matchAll(/^\s*- ((?:AC|[ADSRU])\d+)\b/gm)];
  const ids = defined.length ? new RegExp(`\\b(?:${defined.map((m) => m[1]).join('|')})\\b`, 'g') : null;

  const questions = input.tool_input?.questions ?? [];
  const texts = questions.flatMap((q) => [
    q.question,
    q.header,
    ...(q.options ?? []).flatMap((o) => [o.label, o.description]),
  ]);
  const found = [];
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    const bare = text.replace(LABELLED, ' ');
    const terms = [...new Set([...(ids ? bare.matchAll(ids) : []), ...bare.matchAll(PHRASES)].map((m) => m[0]))];
    if (terms.length) found.push(`- "${text}": ${terms.join(', ')}`);
  }

  const blocks = Number(state.questionBlocks) || 0;
  if (found.length === 0 || blocks >= CAP) {
    if (blocks) {
      delete state.questionBlocks;
      writeState(dir, id, state);
    }
    allow();
  }
  state.questionBlocks = blocks + 1;
  writeState(dir, id, state);
  deny(
    '',
    '',
    [
      'loopwright: this question has loopwright labels the user has not met, so it was not shown:',
      ...found,
      `Say each one in everyday words first and put the label in brackets after it, as in ${USER_MESSAGES_RULES}. Then ask again.`,
    ].join('\n'),
  );
} catch (err) {
  failOpen(err);
}
