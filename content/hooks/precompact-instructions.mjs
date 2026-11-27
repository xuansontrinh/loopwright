#!/usr/bin/env node
// PreCompact hook (Claude Code only): tell compaction what the summary must keep while a task is active.
// https://code.claude.com/docs/en/hooks.md (PreCompact output): exit 0 with stdout uses the stdout as instructions for the compaction summary.
import {
  USER_MESSAGES_RULES,
  allow,
  exitIfHooksOff,
  failOpen,
  loopwrightDir,
  readState,
  readStdinJson,
  worktreeId,
} from './lib.mjs';

exitIfHooksOff();

try {
  const input = await readStdinJson();
  const cwd = input.project_path || input.cwd || process.cwd();
  const dir = loopwrightDir(cwd);
  if (!dir) allow();
  const state = readState(dir, worktreeId(cwd));
  if (!state) allow();

  const lines = [`loopwright task in progress: ${state.task} (stage: ${state.stage}).`];
  if (state.awaitingUser) lines.push(`Waiting on the user: ${state.awaitingUser}`);
  lines.push(
    'Keep in the summary, word for word where it is a quote:',
    '- the task file path and the stage;',
    '- any question the user has not answered yet, with its options;',
    '- unresolved review findings, verbatim;',
    "- the last review round's findings sent to Build and its undecided findings not yet asked, word for word until the next verdict;",
    '- the implementer report, if a second review pass is still due;',
    '- any user decision that is not yet written in the task file;',
    `- that every message to the user follows ${USER_MESSAGES_RULES}, which is read again after compaction.`,
    'After compaction, re-read the task file before continuing.',
  );
  process.stdout.write(lines.join('\n') + '\n');
  allow();
} catch (err) {
  failOpen(err);
}
