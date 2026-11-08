// Loopwright hook runtime library. Only node:* imports.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const MAX_BUFFER = 1024 * 1024 * 1024;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

export function gitTopLevel(cwd) {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

function mainWorktreeRoot(cwd) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (basename(common) === '.git') return dirname(common);
  return gitTopLevel(cwd);
}

/** Main-worktree .loopwright directory if it exists; null outside git or if absent. */
export function loopwrightDir(cwd) {
  try {
    const dir = join(mainWorktreeRoot(cwd), '.loopwright');
    return existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

export function worktreeId(cwd) {
  return createHash('sha256').update(gitTopLevel(cwd)).digest('hex').slice(0, 12);
}

export function statePath(dir, id) {
  return join(dir, 'state', `${id}.json`);
}

export function readState(dir, id) {
  const path = statePath(dir, id);
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    process.stderr.write(`loopwright: ignoring corrupt state file ${path}\n`);
    return null;
  }
}

export function writeState(dir, id, state) {
  const path = statePath(dir, id);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, path);
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function fingerprint(cwd, baseCommit) {
  const h = createHash('sha256');
  h.update(execFileSync('git', ['diff', '--binary', baseCommit], { cwd, maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] }));
  const top = gitTopLevel(cwd);
  const out = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: top, maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  const files = out.split('\0').filter(Boolean).sort();
  for (const f of files) {
    h.update(f + '\0');
    try {
      h.update(readFileSync(join(top, f)));
    } catch {
      /* unreadable or vanished: path alone contributes */
    }
  }
  return h.digest('hex');
}

export async function readStdinJson() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

export function allow() {
  process.exit(0);
}

// Claude and Codex both block via stderr reason + exit 2. The reason must be
// non-empty: Codex ignores exit 2 with empty stderr.
export function deny(_tool, _event, reason) {
  const text = String(reason ?? '').trim() || 'loopwright: blocked';
  process.stderr.write(text + '\n');
  process.exit(2);
}

export function failOpen(err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`loopwright hook error: ${msg}\n`);
  process.exit(0);
}
