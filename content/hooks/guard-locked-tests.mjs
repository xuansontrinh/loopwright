#!/usr/bin/env node
// PreToolUse guard: block edits to locked acceptance tests during the build stage.
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  allow,
  exitIfHooksOff,
  deny,
  failOpen,
  gitTopLevel,
  loopwrightDir,
  realpathLoose,
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

/** Top-level of the worktree holding abs (via its nearest existing folder); null outside git. */
function ownerTop(abs) {
  let cur = dirname(abs);
  while (!existsSync(cur) && dirname(cur) !== cur) cur = dirname(cur);
  try {
    return gitTopLevel(cur);
  } catch {
    return null;
  }
}

/** Locked test paths of the task building in the worktree at top; empty unless it is in build. */
function lockedTests(top) {
  const dir = loopwrightDir(top);
  const state = dir && readState(dir, worktreeId(top));
  if (!state || state.stage !== 'build' || !Array.isArray(state.lockedTests)) return new Set();
  return new Set(state.lockedTests.map((l) => l.path));
}

exitIfHooksOff();

try {
  const input = await readStdinJson();
  // Junie runs hooks from ~/.junie and reports the repo as project_path.
  const cwd = input.project_path || input.cwd || process.cwd();
  const ti = input.tool_input ?? {};
  const raw =
    input.tool_name === 'apply_patch'
      ? patchPaths(ti.patch ?? ti.command)
      : ti.file_path && input.tool_name !== 'Read' // Junie fires PreToolUse for reads too; only edits are guarded
        ? [ti.file_path]
        : [];
  // A file is locked by the session worktree's task or by its own worktree's, which need not match: check both.
  const lockedByTop = new Map();
  for (const p of raw) {
    const abs = realpathLoose(isAbsolute(p) ? resolve(p) : resolve(cwd, p));
    for (const top of new Set([cwd, ownerTop(abs) ?? cwd])) {
      if (!lockedByTop.has(top)) lockedByTop.set(top, lockedTests(top));
      const locked = lockedByTop.get(top);
      if (locked.size === 0) continue;
      const rel = repoRelative(top, abs);
      if (locked.has(rel))
        deny('', '', `loopwright: ${rel} is a locked acceptance test. Ask the user before changing it.`);
    }
  }
  allow();
} catch (err) {
  failOpen(err);
}
