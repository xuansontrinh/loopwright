#!/usr/bin/env node
// PreToolUse guard: block edits to locked acceptance tests during the build stage.
import {
  allow,
  exitIfHooksOff,
  deny,
  failOpen,
  loopwrightDir,
  readState,
  readStdinJson,
  repoRelative,
  worktreeId,
} from './lib.mjs';

function patchPaths(command) {
  const out = [];
  for (const line of String(command ?? '').split('\n')) {
    for (const prefix of ['*** Add File: ', '*** Update File: ', '*** Delete File: ', '*** Move to: ']) {
      if (line.startsWith(prefix)) out.push(line.slice(prefix.length).trim());
    }
  }
  return out;
}

exitIfHooksOff();

try {
  const input = await readStdinJson();
  // Junie runs hooks from ~/.junie and reports the repo as project_path.
  const cwd = input.project_path || input.cwd || process.cwd();
  const dir = loopwrightDir(cwd);
  if (!dir) allow();
  const state = readState(dir, worktreeId(cwd));
  if (!state || state.stage !== 'build' || !Array.isArray(state.lockedTests) || state.lockedTests.length === 0) allow();

  const ti = input.tool_input ?? {};
  const raw =
    input.tool_name === 'apply_patch'
      ? patchPaths(ti.patch ?? ti.command)
      : ti.file_path && input.tool_name !== 'Read' // Junie fires PreToolUse for reads too; only edits are guarded
        ? [ti.file_path]
        : [];
  const locked = new Set(state.lockedTests.map((l) => l.path));
  for (const p of raw) {
    const rel = repoRelative(cwd, p);
    if (locked.has(rel))
      deny('', '', `loopwright: ${rel} is a locked acceptance test. Ask the user before changing it.`);
  }
  allow();
} catch (err) {
  failOpen(err);
}
