#!/usr/bin/env node
// Loopwright state tool. Usage: node lw.mjs <cmd> [args]
import { copyFileSync, existsSync, readFileSync, readdirSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isatty } from 'node:tty';
import { fileURLToPath } from 'node:url';
import {
  PROFILES,
  fingerprint,
  gitTopLevel,
  loopwrightDir,
  loopwrightPath,
  mainLoopwrightPath,
  mainWorktreeRoot,
  readState,
  realpathLoose,
  repoRelative,
  sha256File,
  statePath,
  worktreeId,
  writeState,
} from './lib.mjs';

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

/** Config a fresh install starts from: the user's, else the shipped default. */
const seedConfig = () => {
  const user = join(homedir(), '.config', 'loopwright', 'config.json');
  return existsSync(user) ? user : fileURLToPath(new URL('./default-config.json', import.meta.url));
};

/** Create <worktree>/.loopwright/ (global installs, fresh clones, new worktrees). Only the main checkout holds config.json. */
function scaffold(dir, withConfig) {
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'state'), { recursive: true });
  const ignore = join(dir, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  const cfg = join(dir, 'config.json');
  if (withConfig && !existsSync(cfg)) copyFileSync(seedConfig(), cfg);
}

const isMainCheckout = () => gitTopLevel(cwd) === mainWorktreeRoot(cwd);

function ctx(create = false) {
  const dir = loopwrightPath(cwd);
  if (!dir) fail('loopwright: no .loopwright directory found (not inside a git repository)');
  if (!existsSync(dir) && !create)
    fail('loopwright: no active task (no .loopwright directory yet; lw.mjs start creates it)');
  if (create) scaffold(dir, isMainCheckout()); // idempotent: seeds a config.json missing from an existing main .loopwright/
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
  if (!Object.hasOwn(PROFILES.balanced, role))
    fail(`loopwright: usage: effort <${Object.keys(PROFILES.balanced).join('|')}>`);
  // Works before `start` (Plan's scout spawn): no task or repo state just means no header.
  let name;
  try {
    const dir = loopwrightDir(cwd);
    const state = dir && readState(dir, worktreeId(cwd));
    if (state?.task && existsSync(join(dir, state.task))) {
      name = /^profile:\s*(\S+)\s*$/m.exec(readFileSync(join(dir, state.task), 'utf8').split(/^## /m)[0])?.[1];
    }
  } catch {
    // Unreadable task or state: fall through to the manifest profile.
  }
  // Main checkout's manifest first (it exists once), then the global one (global installs record it under ~/.config/loopwright).
  const main = mainLoopwrightPath(cwd);
  for (const m of [main && join(main, 'manifest.json'), join(homedir(), '.config', 'loopwright', 'manifest.json')]) {
    if (name || !m || !existsSync(m)) continue;
    try {
      name = JSON.parse(readFileSync(m, 'utf8')).options?.profile;
    } catch {
      // Unreadable manifest: try the next one.
    }
  }
  name ??= 'balanced';
  if (!Object.hasOwn(PROFILES, name))
    fail(`loopwright: unknown profile '${name}' (allowed: ${Object.keys(PROFILES).join(', ')})`);
  return PROFILES[name][role];
}

const gitOut = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The worktree a task header names: `worktree: <path> (branch <name>)`. */
function namedWorktree(header) {
  const m = /^worktree:[ \t]*(.+?)(?:[ \t]+\(branch[ \t]+(.*?)\))?[ \t]*$/m.exec(header);
  return m ? { path: resolve(m[1]), branch: m[2] ?? null } : null;
}

/** Task file fields: status/stage from the header (before the first `## `), title from `# `, goal from `## Goal`. */
function readTask(root, rel) {
  const [head, ...sections] = readFileSync(join(root, rel), 'utf8').split(/^## /m);
  const goal = sections.find((s) => /^Goal[ \t]*\r?\n/.test(s));
  return {
    title: /^# (.*)$/m.exec(head)?.[1].trim() ?? null,
    status: /^status:[ \t]*(\S+)/m.exec(head)?.[1] ?? null,
    stage: /^stage:[ \t]*(\S+)/m.exec(head)?.[1] ?? null,
    named: namedWorktree(head),
    goal: goal ? goal.replace(/^Goal[ \t]*\r?\n/, '').trim() : '',
  };
}

/** `git worktree list`: the main checkout first, then linked worktrees. A missing folder is still listed. */
const listWorktrees = () =>
  gitOut(['worktree', 'list', '--porcelain'])
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((b) => ({
      path: resolve(/^worktree (.+)$/m.exec(b)[1]),
      branch: /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] ?? null,
    }));

/** A move copies; the source stays, marked so no listing offers it again. */
function markMoved(file, to) {
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^status:.*$/m, `status: moved\nmoved to: ${to}`));
}

const today = () => {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

/** File name (no extension) for a stub: date plus the title with spaces and path characters dashed. */
const stubBase = (title) => `${today()}-${title.replace(/\s+/g, '-').replace(/[\\/:*?"<>|]/g, '-')}`;

/** Write `tasks/<base>.md`, adding `-2`, `-3`... on a name collision; returns the path relative to `dir`. */
function writeUnique(dir, base, text) {
  for (let n = 1; ; n++) {
    const rel = `tasks/${base}${n === 1 ? '' : `-${n}`}.md`;
    try {
      writeFileSync(join(dir, rel), text, { flag: 'wx' });
      return rel;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

/** A proposed stub in park's format; `goal` is empty for a stub parked mid-task. */
const stubText = (header, goal = '') => `${header.join('\n')}\n\n## Goal\n${goal ? `${goal}\n` : ''}\n## Evidence\n`;

const refExists = (ref) => {
  try {
    gitOut(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

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
      // A task file belongs to the worktree its header names; starting it elsewhere would split its state.
      const own = loopwrightPath(cwd);
      const header = own && existsSync(join(own, task)) ? readFileSync(join(own, task), 'utf8').split(/^## /m)[0] : '';
      const named = namedWorktree(header)?.path;
      if (named && realpathLoose(named) !== realpathLoose(gitTopLevel(cwd)))
        fail(`loopwright: ${task} belongs to the worktree ${named}; start it there`);
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
    case 'reopen': {
      const target = rest[0];
      if (target !== 'plan' && target !== 'test') fail('loopwright: usage: reopen <plan|test> "<reason>"');
      const reason = rest.slice(1).join(' ').trim();
      if (!reason) fail('loopwright: reopen requires a reason');
      const { dir, id, state } = requireState();
      if (!(state.history ?? []).some((e) => e.event === 'stage' && e.detail === 'build'))
        fail('loopwright: reopen is only for a task that has begun Build');
      state.stage = target;
      state.stopBlocks = 0;
      delete state.awaitingUser;
      note(state, 'reopen', target);
      state.history.at(-1).reason = reason;
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
      // A reopen covers re-locks until the next Build starts, but only when the history reads
      // await-user, resume, reopen with nothing between (the pair the skills run around the user's answer
      // to going back); any other reopen is ignored. A faked triple is not detected.
      const lockedAfterBuild = [];
      const relockedAfterReopen = [];
      const seen = new Map();
      let reopenReason = null;
      let prev = null;
      let prev2 = null;
      for (const e of state.history ?? []) {
        const sanctioned = prev2 === 'await-user' && prev === 'resume';
        prev2 = prev;
        prev = e.event;
        if (e.event === 'stage' && e.detail === 'build') {
          for (const p of seen.keys()) seen.set(p, true);
          reopenReason = null;
        }
        if (e.event === 'reopen' && sanctioned) reopenReason = e.reason ?? '';
        if (e.event !== 'lock') continue;
        if (seen.get(e.detail) === true) {
          if (reopenReason !== null) {
            if (!relockedAfterReopen.some((r) => r.path === e.detail))
              relockedAfterReopen.push({ path: e.detail, reason: reopenReason });
          } else if (!lockedAfterBuild.includes(e.detail)) lockedAfterBuild.push(e.detail);
        }
        seen.set(e.detail, false);
      }
      let built = false;
      let forcedRestartAfterBuild = false;
      for (const e of state.history ?? []) {
        if (e.event === 'stage' && e.detail === 'build') built = true;
        if (built && e.event === 'start' && e.detail === '--force') forcedRestartAfterBuild = true;
      }
      out({ ok, changed, missing, lockedAfterBuild, relockedAfterReopen, forcedRestartAfterBuild });
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
      if (roundRaw === undefined || !Number.isInteger(round) || round < 0)
        fail('loopwright: verdict requires --round <n>');
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
    case 'tasks': {
      // Read-only: lists what is open in every worktree. Never creates a .loopwright/ or touches a task.
      const real = (p) => realpathLoose(resolve(p));
      const here = real(gitTopLevel(cwd));
      const trees = listWorktrees();
      const [main] = trees;
      const live = trees.filter((t) => t !== main && existsSync(t.path));
      const result = { inProgress: [], proposed: [], olderLayout: [], worktreeGone: [], unreadable: [] };
      const entry = (wt, branch, task, t) => ({
        worktree: wt,
        branch,
        task,
        title: t.title,
        stage: t.stage,
        goal: t.goal,
        current: real(wt) === here,
      });
      const gone = new Map();
      for (const wt of trees) {
        const root = join(wt.path, '.loopwright');
        let names = [];
        try {
          if (existsSync(join(root, 'tasks')))
            names = readdirSync(join(root, 'tasks')).filter((n) => n.endsWith('.md'));
          else if (!existsSync(wt.path)) throw new Error('folder missing');
        } catch (err) {
          result.unreadable.push({ worktree: wt.path, branch: wt.branch, reason: err.message });
          continue;
        }
        for (const name of names.sort()) {
          const task = `tasks/${name}`;
          let t;
          try {
            t = readTask(root, task);
          } catch {
            continue; // one unreadable file does not hide the rest
          }
          if (['done', 'stopped', 'moved', 'dropped'].includes(t.status)) continue;
          if (t.status === 'proposed') {
            result.proposed.push(entry(wt.path, wt.branch, task, t));
            continue;
          }
          // Task files written before per-worktree layout sit in the main checkout and name their worktree.
          if (wt === main && t.named && real(t.named.path) !== real(main.path)) {
            const owner = live.find((l) => real(l.path) === real(t.named.path));
            if (owner) result.olderLayout.push(entry(owner.path, owner.branch, task, t));
            else gone.set(`${t.named.path}\0${task}`, entry(t.named.path, t.named.branch, task, t));
            continue;
          }
          result.inProgress.push(entry(wt.path, wt.branch, task, t));
        }
      }
      // A state file whose worktree folder is gone, even when its task file is too.
      const stateDir = join(main.path, '.loopwright', 'state');
      for (const name of existsSync(stateDir) ? readdirSync(stateDir).sort() : []) {
        let s;
        try {
          s = JSON.parse(readFileSync(join(stateDir, name), 'utf8'));
        } catch {
          continue;
        }
        if (typeof s?.worktree !== 'string' || typeof s.task !== 'string' || existsSync(s.worktree)) continue;
        const key = `${resolve(s.worktree)}\0${s.task}`;
        let t = { title: null, stage: null, goal: '' };
        try {
          t = readTask(join(main.path, '.loopwright'), s.task);
        } catch {
          // Task file gone too: report the state alone.
        }
        // An adopted or finished task leaves its main-checkout state behind; its header says it is closed.
        if (['done', 'stopped', 'moved', 'dropped'].includes(t.status)) continue;
        gone.set(key, entry(resolve(s.worktree), s.branch ?? null, s.task, { ...t, stage: s.stage ?? t.stage }));
      }
      result.worktreeGone.push(...gone.values());
      out(result);
      break;
    }
    case 'adopt': {
      // Pulls a task written before per-worktree layout (main checkout) into the worktree it names. Copies; never deletes.
      const task = rest[0];
      if (!task) fail('loopwright: usage: adopt <task-rel-path>');
      if (isMainCheckout())
        fail('loopwright: adopt runs in the linked worktree that should own the task, not in the main checkout');
      const mainDir = mainLoopwrightPath(cwd);
      const src = join(mainDir, task);
      if (!existsSync(src)) fail(`loopwright: adopt: ${task} not found in the main checkout's .loopwright/`);
      const named = namedWorktree(readFileSync(src, 'utf8').split(/^## /m)[0]);
      if (named && realpathLoose(named.path) !== realpathLoose(gitTopLevel(cwd)))
        fail(`loopwright: adopt: ${task} belongs to the worktree ${named.path}; run adopt there`);
      const id = worktreeId(cwd);
      const old = readState(mainDir, id);
      const state = old?.task === task ? old : null;
      const own = loopwrightPath(cwd);
      if (existsSync(join(own, task))) fail(`loopwright: adopt: ${task} already exists in this worktree`);
      if (state && readState(own, id)) fail('loopwright: adopt: this worktree already has an active task');
      const { dir } = ctx(true);
      copyFileSync(src, join(dir, task));
      if (state) {
        note(state, 'adopt', task);
        writeState(dir, id, state);
      }
      markMoved(src, join(dir, task));
      out({ task, state: Boolean(state) });
      break;
    }
    case 'worktree': {
      // Creates a sibling worktree on a new branch with a stub to plan from. Does not enter it or start a session there.
      const usage = 'loopwright: usage: worktree "<title>" [--base <ref>] [--stub <file>] [--kind feature|fix]';
      const baseFlag = flag(rest, '--base');
      const stubFlag = flag(rest, '--stub');
      const kind = flag(rest, '--kind') ?? 'feature';
      const title = rest.join(' ').trim();
      if (!title) fail(usage);
      if (kind !== 'feature' && kind !== 'fix') fail(`${usage} (kind must be feature or fix)`);
      // Validate everything before git changes anything.
      let source = null;
      if (stubFlag) {
        source = resolve(loopwrightPath(cwd), stubFlag);
        if (!existsSync(source)) fail(`loopwright: worktree: stub ${stubFlag} not found`);
        if (readTask(dirname(source), basename(source)).status !== 'proposed')
          fail(`loopwright: worktree: ${stubFlag} is not a proposed stub`);
      }
      let goal = '';
      // isatty, not process.stdin.isTTY: touching process.stdin makes a piped fd 0 non-blocking, so a slow writer fails readFileSync with EAGAIN.
      if (!source && !isatty(0)) goal = readFileSync(0, 'utf8').trim();
      let base = baseFlag;
      if (base !== undefined) {
        if (base.startsWith('-') || !refExists(base)) fail(`loopwright: worktree: unknown base '${base}'`);
      } else {
        // The remote's default branch beats a local main that may be ahead or stale-checked-out.
        base = ['origin/HEAD', 'main', 'master'].find(refExists) ?? 'HEAD';
      }
      const main = mainWorktreeRoot(cwd);
      const slug =
        title
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, '-')
          .replace(/^-+|-+$/g, '') || 'task';
      let name;
      let folder;
      for (let n = 1; ; n++) {
        name = `${slug}${n === 1 ? '' : `-${n}`}`;
        folder = join(dirname(main), `${basename(main)}-${name}`);
        if (!existsSync(folder) && !refExists(`refs/heads/${name}`)) break;
      }
      gitOut(['worktree', 'add', '--no-track', '-b', name, folder, base]);
      const dir = join(folder, '.loopwright');
      scaffold(dir, false);
      let stub;
      if (source) {
        stub = `tasks/${basename(source)}`;
        copyFileSync(source, join(dir, stub));
        markMoved(source, join(dir, stub));
      } else {
        stub = writeUnique(
          dir,
          stubBase(title),
          stubText([`# ${title}`, '', `kind: ${kind}`, 'status: proposed', 'stage: plan', 'plan: draft'], goal),
        );
      }
      const hook = join('.agents', 'loopwright', 'hooks', 'lw.mjs');
      out({
        worktree: folder,
        branch: name,
        base,
        stub,
        installMissing: existsSync(join(gitTopLevel(cwd), hook)) && !existsSync(join(folder, hook)),
      });
      break;
    }
    case 'carry': {
      // Moves this worktree's proposed stubs to the main checkout so they outlive the worktree. Copies; never deletes.
      if (isMainCheckout())
        fail('loopwright: carry runs in a linked worktree; the main checkout already holds its stubs');
      const own = loopwrightPath(cwd);
      const mainDir = mainLoopwrightPath(cwd);
      scaffold(mainDir, true);
      const carried = [];
      const names = existsSync(join(own, 'tasks')) ? readdirSync(join(own, 'tasks')).sort() : [];
      for (const name of names.filter((n) => n.endsWith('.md'))) {
        const file = join(own, 'tasks', name);
        let status;
        try {
          status = readTask(own, `tasks/${name}`).status;
        } catch {
          continue; // one unreadable file does not block the rest
        }
        if (status !== 'proposed') continue;
        const to = join(mainDir, writeUnique(mainDir, name.slice(0, -3), readFileSync(file, 'utf8')));
        markMoved(file, to);
        carried.push({ from: file, to });
      }
      out({ carried });
      break;
    }
    case 'config': {
      const main = mainLoopwrightPath(cwd);
      const file = main && join(main, 'config.json');
      out(JSON.parse(readFileSync(file && existsSync(file) ? file : seedConfig(), 'utf8')));
      break;
    }
    case 'effort':
      process.stdout.write(effortFor(rest[0]) + '\n');
      break;
    case 'park': {
      // Captures work found mid-task as a proposed stub. Reads state only to find the active task; never writes it.
      const usage = 'loopwright: usage: park "<title>" [--blocks] [--kind feature|fix]';
      const blocks = rest.includes('--blocks');
      if (blocks) rest.splice(rest.indexOf('--blocks'), 1);
      const kind = flag(rest, '--kind') ?? 'feature';
      if (kind !== 'feature' && kind !== 'fix') fail(`${usage} (kind must be feature or fix)`);
      const title = rest.join(' ').trim();
      if (!title) fail(usage);
      const existing = loopwrightDir(cwd);
      const active = existing ? (readState(existing, worktreeId(cwd))?.task ?? null) : null;
      if (blocks && !active) fail('loopwright: park --blocks needs an active task');
      const { dir } = ctx(true);
      const foundWhile = active && existsSync(join(dir, active)) ? active : null;
      if (active && !foundWhile)
        process.stderr.write(`loopwright: warning: active task file ${active} is missing; follow-up not linked\n`);
      const header = [`# ${title}`, '', `kind: ${kind}`, 'status: proposed', 'stage: plan', 'plan: draft'];
      if (foundWhile) header.push(`found while: ${foundWhile}`);
      if (blocks && foundWhile) header.push(`blocks: ${foundWhile}`);
      const stub = writeUnique(dir, stubBase(title), stubText(header));
      if (foundWhile) {
        const line = `- ${title} — ${stub}${blocks ? ' [blocking]' : ''}`;
        const file = join(dir, foundWhile);
        const body = readFileSync(file, 'utf8');
        const m = /^## Follow-ups[ \t]*$/m.exec(body);
        let next;
        if (!m) next = body.replace(/\n*$/, '\n') + `\n## Follow-ups\n${line}\n`;
        else {
          const start = m.index + m[0].length;
          const end = body.slice(start).search(/^## /m);
          const stop = end === -1 ? body.length : start + end;
          const section = body.slice(start, stop).replace(/\s*$/, '');
          next = body.slice(0, start) + section + `\n${line}\n` + (end === -1 ? '' : '\n') + body.slice(stop);
        }
        writeFileSync(file, next);
      }
      out({ stub, foundWhile, blocks: Boolean(blocks && foundWhile) });
      break;
    }
    case 'explore': {
      // Run-folder bookkeeping for /loopwright-explore. Never reads or writes worktree state.
      const usage = 'loopwright: usage: explore "<scope>" [--new]';
      const fresh = rest.includes('--new');
      if (fresh) rest.splice(rest.indexOf('--new'), 1);
      if (rest.length > 1) fail(usage);
      const top = gitTopLevel(cwd);
      const abs = resolve(top, rest[0] ?? '.');
      const rel = relative(top, abs).split(sep).join('/');
      if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(abs))
        fail(`loopwright: explore: scope path does not exist in this repository: ${rest[0] ?? '.'}`);
      const scope = rel || '.';
      const headSha = () => {
        try {
          return gitOut(['rev-parse', 'HEAD']);
        } catch {
          return null; // repo without commits
        }
      };
      const { dir } = ctx(true);
      const root = join(dir, 'explore');
      mkdirSync(root, { recursive: true });
      const field = (text, name) => new RegExp(`^${name}: (.*)$`, 'm').exec(text)?.[1];
      // Same date, then the shorter name first, so `-2` sorts before `-10`.
      const byAge = (a, b) => a.slice(0, 10).localeCompare(b.slice(0, 10)) || a.length - b.length || a.localeCompare(b);
      let open = null;
      for (const name of readdirSync(root).sort(byAge)) {
        let text;
        try {
          text = readFileSync(join(root, name, 'run.md'), 'utf8');
        } catch {
          continue;
        }
        if (field(text, 'scope') === scope && field(text, 'status') === 'in-progress') open = { name, text };
      }
      const head = headSha();
      // Paths, not a boolean, so the skill can name them. -z keeps odd names unquoted; -uall lists files inside new folders.
      const dirty = [];
      const entries = execFileSync('git', ['status', '--porcelain', '-z', '-uall'], {
        cwd: top,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .split('\0')
        .filter(Boolean);
      for (let i = 0; i < entries.length; i++) {
        dirty.push(entries[i].slice(3));
        if (/^[RC]/.test(entries[i])) i++; // renames carry the old path as the next entry
      }
      dirty.sort();
      let name;
      let commit;
      let resume = false;
      if (open && !fresh) {
        ({ name } = open);
        resume = true;
        const c = field(open.text, 'commit');
        commit = c === undefined || c === 'null' ? null : c;
      } else {
        if (open)
          writeFileSync(join(root, open.name, 'run.md'), open.text.replace(/^status: .*$/m, 'status: abandoned'));
        const d = new Date();
        const p2 = (n) => String(n).padStart(2, '0');
        const today = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
        const slug = scope === '.' ? 'repo' : scope.replace(/\s+/g, '-').replace(/[\\/:*?"<>|]/g, '-');
        for (let n = 1; ; n++) {
          name = `${today}-${slug}${n === 1 ? '' : `-${n}`}`;
          try {
            mkdirSync(join(root, name));
            break;
          } catch (err) {
            if (err.code !== 'EEXIST') throw err;
          }
        }
        commit = head;
        writeFileSync(
          join(root, name, 'run.md'),
          `scope: ${scope}\ncommit: ${commit}\nstarted: ${today}\nstatus: in-progress\ndirty: ${dirty.length ? 'yes' : 'no'}\n`,
        );
      }
      const present = [];
      const walk = (sub) => {
        for (const e of readdirSync(join(root, name, sub), { withFileTypes: true })) {
          const r = sub ? `${sub}/${e.name}` : e.name;
          if (e.isDirectory()) walk(r);
          else present.push(r);
        }
      };
      if (resume) walk('');
      out({ dir: `explore/${name}`, resume, commit, head, dirty, present: present.sort() });
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
      fail(
        'loopwright: usage: lw.mjs <dir|start|stage|reopen|lock|check-locks|fingerprint|verdict|await-user|resume|park|explore|status|config|tasks|adopt|worktree|carry|effort|done>',
      );
  }
} catch (err) {
  fail(`loopwright: ${err instanceof Error ? err.message : String(err)}`);
}
