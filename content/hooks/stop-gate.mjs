#!/usr/bin/env node
// Stop hook: block stopping in build/review without a passing review for the current code.
import { allow, deny, failOpen, fingerprint, loopwrightDir, readState, readStdinJson, worktreeId, writeState } from './lib.mjs';

const CAP = 3;

try {
  const input = await readStdinJson();
  const cwd = input.cwd || process.cwd();
  const dir = loopwrightDir(cwd);
  if (!dir) allow();
  const id = worktreeId(cwd);
  const state = readState(dir, id);
  if (!state || (state.stage !== 'build' && state.stage !== 'review')) allow();

  const v = state.verdict;
  if (v && v.pass === true && v.fingerprint === fingerprint(cwd, state.baseCommit)) allow();

  const blocks = Number(state.stopBlocks) || 0;
  if (blocks >= CAP) {
    process.stderr.write('loopwright: stop-gate limit reached; review gate NOT satisfied.\n');
    allow();
  }
  state.stopBlocks = blocks + 1;
  (state.history ??= []).push({ event: 'stop-blocked', detail: String(state.stopBlocks), at: new Date().toISOString() });
  writeState(dir, id, state);
  deny('', '', 'loopwright: no passing review for the current code. Run /loopwright-review (or finish the fix loop) before stopping.');
} catch (err) {
  failOpen(err);
}
