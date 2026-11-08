#!/usr/bin/env node
// Loopwright state tool. Usage: node lw.mjs <cmd> [args]
import { existsSync, unlinkSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fingerprint, gitTopLevel, loopwrightDir, readState, sha256File, statePath, worktreeId, writeState } from './lib.mjs';

const STAGES = ['plan', 'test', 'build', 'review', 'done'];
const cwd = process.cwd();

function fail(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}
const note = (state, event, detail) => {
  (state.history ??= []).push({ event, detail, at: new Date().toISOString() });
};
const out = (v) => process.stdout.write(JSON.stringify(v, null, 2) + '\n');

function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined) fail(`loopwright: ${name} requires a value`);
  args.splice(i, 2);
  return v;
}

function ctx() {
  const dir = loopwrightDir(cwd);
  if (!dir) fail('loopwright: no .loopwright directory found');
  return { dir, id: worktreeId(cwd) };
}

function requireState() {
  const { dir, id } = ctx();
  const state = readState(dir, id);
  if (!state) fail('loopwright: no active task (run lw.mjs start <task-file>)');
  return { dir, id, state };
}

const gitOut = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const [cmd, ...rest] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'dir':
      process.stdout.write((loopwrightDir(cwd) ?? 'null') + '\n');
      break;
    case 'start': {
      const base = flag(rest, '--base') ?? 'HEAD';
      const force = rest.includes('--force');
      if (force) rest.splice(rest.indexOf('--force'), 1);
      const task = rest[0];
      if (!task) fail('loopwright: usage: start <task-rel-path> [--base <sha>]');
      const { dir, id } = ctx();
      if (!force && readState(dir, id)) fail('loopwright: task already active (run lw.mjs done first, or start --force)');
      const state = {
        version: 1,
        task,
        stage: 'plan',
        baseCommit: gitOut(['rev-parse', base]),
        worktree: gitTopLevel(cwd),
        branch: gitOut(['rev-parse', '--abbrev-ref', 'HEAD']),
        lockedTests: [],
        verdict: null,
        stopBlocks: 0,
        history: [],
      };
      note(state, force ? 'start --force' : 'start', task);
      writeState(dir, id, state);
      out(state);
      break;
    }
    case 'stage': {
      const name = rest[0];
      if (!STAGES.includes(name)) fail(`loopwright: invalid stage '${name ?? ''}' (one of ${STAGES.join(', ')})`);
      const { dir, id, state } = requireState();
      state.stage = name;
      state.stopBlocks = 0;
      note(state, 'stage', name);
      writeState(dir, id, state);
      out(state);
      break;
    }
    case 'lock': {
      if (rest.length === 0) fail('loopwright: usage: lock <paths...>');
      const { dir, id, state } = requireState();
      if (state.stage !== 'test') fail('loopwright: tests can only be locked in stage test');
      const top = gitTopLevel(cwd);
      for (const p of rest) {
        const abs = isAbsolute(p) ? p : resolve(cwd, p);
        if (!existsSync(abs)) fail(`loopwright: cannot lock missing file ${p}`);
        const rel = relative(top, abs).split(sep).join('/');
        if (rel.startsWith('..')) fail(`loopwright: path outside worktree: ${p}`);
        const entry = { path: rel, sha256: sha256File(abs) };
        const i = state.lockedTests.findIndex((l) => l.path === rel);
        if (i === -1) state.lockedTests.push(entry);
        else state.lockedTests[i] = entry;
        note(state, 'lock', rel);
      }
      writeState(dir, id, state);
      out(state.lockedTests);
      break;
    }
    case 'check-locks': {
      const { state } = requireState();
      const top = gitTopLevel(cwd);
      const changed = [];
      const missing = [];
      for (const l of state.lockedTests) {
        const abs = resolve(top, l.path);
        if (!existsSync(abs)) missing.push(l.path);
        else if (sha256File(abs) !== l.sha256) changed.push(l.path);
      }
      const ok = changed.length === 0 && missing.length === 0;
      const hist = state.history ?? [];
      const b = hist.findIndex((e) => e.event === 'stage' && e.detail === 'build');
      const lockedAfterBuild = b === -1 ? [] : [...new Set(hist.slice(b + 1).filter((e) => e.event === 'lock').map((e) => e.detail))];
      out({ ok, changed, missing, lockedAfterBuild });
      process.exit(ok ? 0 : 1);
      break;
    }
    case 'fingerprint': {
      const { state } = requireState();
      out({ fingerprint: fingerprint(cwd, state.baseCommit) });
      break;
    }
    case 'verdict': {
      const result = rest.shift();
      if (result !== 'pass' && result !== 'fail') fail('loopwright: usage: verdict <pass|fail> --round <n>');
      const roundRaw = flag(rest, '--round');
      const round = Number(roundRaw);
      if (roundRaw === undefined || !Number.isInteger(round) || round < 0) fail('loopwright: verdict requires --round <n>');
      const { dir, id, state } = requireState();
      state.verdict = { pass: result === 'pass', fingerprint: fingerprint(cwd, state.baseCommit), round };
      note(state, 'verdict', `${result} round ${round}`);
      writeState(dir, id, state);
      out(state.verdict);
      break;
    }
    case 'status': {
      out(requireState().state);
      break;
    }
    case 'done': {
      const { dir, id, state } = requireState();
      state.stage = 'done';
      note(state, 'done', state.task);
      writeState(dir, id, state);
      unlinkSync(statePath(dir, id));
      out(state);
      break;
    }
    default:
      fail('loopwright: usage: lw.mjs <dir|start|stage|lock|check-locks|fingerprint|verdict|status|done>');
  }
} catch (err) {
  fail(`loopwright: ${err instanceof Error ? err.message : String(err)}`);
}
