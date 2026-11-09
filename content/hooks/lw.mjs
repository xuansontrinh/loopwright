#!/usr/bin/env node
// Loopwright state tool. Usage: node lw.mjs <cmd> [args]
import { copyFileSync, existsSync, readFileSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROFILES, fingerprint, gitTopLevel, loopwrightDir, loopwrightPath, readState, repoRelative, sha256File, statePath, worktreeId, writeState } from './lib.mjs';

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

/** Create <main worktree>/.loopwright/ (global installs, fresh clones). Config seeds from ~/.config/loopwright/config.json, else the default. */
function scaffold(dir) {
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'state'), { recursive: true });
  const ignore = join(dir, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  const cfg = join(dir, 'config.json');
  if (existsSync(cfg)) return;
  const user = join(homedir(), '.config', 'loopwright', 'config.json');
  copyFileSync(existsSync(user) ? user : fileURLToPath(new URL('./default-config.json', import.meta.url)), cfg);
}

function ctx(create = false) {
  let dir = loopwrightDir(cwd);
  if (!dir) {
    const path = loopwrightPath(cwd);
    if (!path) fail('loopwright: no .loopwright directory found (not inside a git repository)');
    if (!create) fail('loopwright: no active task (no .loopwright directory yet; lw.mjs start creates it)');
    scaffold(path);
    dir = path;
  } else if (create) scaffold(dir); // idempotent: seeds a config.json missing from an existing .loopwright/
  return { dir, id: worktreeId(cwd) };
}

function requireState() {
  const { dir, id } = ctx();
  const state = readState(dir, id);
  if (!state) fail('loopwright: no active task (run lw.mjs start <task-file>)');
  return { dir, id, state };
}

/** Effort for a role: the task header's `profile:`, else the manifest's recorded profile, else balanced. */
function effortFor(role) {
  if (!Object.hasOwn(PROFILES.balanced, role)) fail(`loopwright: usage: effort <${Object.keys(PROFILES.balanced).join('|')}>`);
  // Works before `start` (Plan's scout spawn): no task or repo state just means no header.
  let name;
  let dir = null;
  try {
    dir = loopwrightDir(cwd);
    const state = dir && readState(dir, worktreeId(cwd));
    if (state?.task && existsSync(join(dir, state.task))) {
      name = /^profile:\s*(\S+)\s*$/m.exec(readFileSync(join(dir, state.task), 'utf8').split(/^## /m)[0])?.[1];
    }
  } catch {}
  // Repo manifest first, then the global one (global installs record it under ~/.config/loopwright).
  for (const m of [dir && join(dir, 'manifest.json'), join(homedir(), '.config', 'loopwright', 'manifest.json')]) {
    if (name || !m || !existsSync(m)) continue;
    try {
      name = JSON.parse(readFileSync(m, 'utf8')).options?.profile;
    } catch {}
  }
  name ??= 'balanced';
  if (!Object.hasOwn(PROFILES, name)) fail(`loopwright: unknown profile '${name}' (allowed: ${Object.keys(PROFILES).join(', ')})`);
  return PROFILES[name][role];
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
      if (!task) fail('loopwright: usage: start <task-rel-path> [--base <sha>] [--force]');
      const { dir, id } = ctx(true);
      const prior = readState(dir, id);
      if (!force && prior) fail('loopwright: task already active (run lw.mjs done first, or start --force)');
      const state = {
        version: 1,
        task,
        stage: 'plan',
        baseCommit: gitOut(['rev-parse', base]),
        worktree: gitTopLevel(cwd),
        branch: gitOut(['rev-parse', '--abbrev-ref', 'HEAD']),
        // A forced restart keeps the audit trail and the lock records, so a locked test edited
        // during Build cannot be re-baselined unnoticed.
        lockedTests: Array.isArray(prior?.lockedTests) ? prior.lockedTests : [],
        verdict: null,
        stopBlocks: 0,
        history: Array.isArray(prior?.history) ? prior.history : [],
      };
      if (force) note(state, 'start', '--force');
      else note(state, 'start', task);
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
      delete state.awaitingUser;
      note(state, 'stage', name);
      writeState(dir, id, state);
      out(state);
      break;
    }
    case 'lock': {
      if (rest.length === 0) fail('loopwright: usage: lock <paths...>');
      const { dir, id, state } = requireState();
      if (state.stage !== 'test') fail('loopwright: tests can only be locked in stage test');
      for (const p of rest) {
        const abs = isAbsolute(p) ? p : resolve(cwd, p);
        if (!existsSync(abs)) fail(`loopwright: cannot lock missing file ${p}`);
        const rel = repoRelative(cwd, p);
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
      // Re-locking an existing lock after a build could launder an implementer's edit; first-time locks in later slices are legitimate.
      const lockedAfterBuild = [];
      const seen = new Map();
      for (const e of state.history ?? []) {
        if (e.event === 'stage' && e.detail === 'build') for (const p of seen.keys()) seen.set(p, true);
        if (e.event !== 'lock') continue;
        if (seen.get(e.detail) === true && !lockedAfterBuild.includes(e.detail)) lockedAfterBuild.push(e.detail);
        seen.set(e.detail, false);
      }
      let built = false;
      let forcedRestartAfterBuild = false;
      for (const e of state.history ?? []) {
        if (e.event === 'stage' && e.detail === 'build') built = true;
        if (built && e.event === 'start' && e.detail === '--force') forcedRestartAfterBuild = true;
      }
      out({ ok, changed, missing, lockedAfterBuild, forcedRestartAfterBuild });
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
      delete state.awaitingUser;
      note(state, 'verdict', `${result} round ${round}`);
      writeState(dir, id, state);
      out(state.verdict);
      break;
    }
    case 'await-user': {
      const reason = rest.join(' ').trim();
      if (!reason) fail('loopwright: usage: await-user <reason>');
      const { dir, id, state } = requireState();
      state.awaitingUser = reason;
      note(state, 'await-user', reason);
      writeState(dir, id, state);
      out(state);
      break;
    }
    case 'resume': {
      const { dir, id, state } = requireState();
      note(state, 'resume', state.awaitingUser ?? '');
      delete state.awaitingUser;
      writeState(dir, id, state);
      out(state);
      break;
    }
    case 'effort':
      process.stdout.write(effortFor(rest[0]) + '\n');
      break;
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
      fail('loopwright: usage: lw.mjs <dir|start|stage|lock|check-locks|fingerprint|verdict|await-user|resume|status|effort|done>');
  }
} catch (err) {
  fail(`loopwright: ${err instanceof Error ? err.message : String(err)}`);
}
