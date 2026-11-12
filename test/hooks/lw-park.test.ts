import { existsSync, unlinkSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeBareRepo, makeRepo, runLw } from './helpers.js';

const A = 'tasks/2026-11-01-task-a.md';
const env = () => {
  const h = realpathSync(mkdtempSync(join(tmpdir(), 'lw-park-home-')));
  return { HOME: h, USERPROFILE: h };
};
const localDate = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const tasksDir = (repo: string) => join(repo, '.loopwright/tasks');
const listTasks = (repo: string) => (existsSync(tasksDir(repo)) ? readdirSync(tasksDir(repo)).sort() : []);
const stateFiles = (repo: string) => {
  const d = join(repo, '.loopwright/state');
  return existsSync(d) ? readdirSync(d).sort() : [];
};

function activeRepo(body = '# Task A\n\nstatus: active\n\n## Goal\nx\n') {
  const repo = makeRepo();
  writeFileSync(join(repo, '.loopwright', A), body);
  const e = env();
  expect(runLw(repo, ['start', A], undefined, e).code).toBe(0);
  return { repo, e };
}

describe('lw.mjs park', () => {
  it('writes a proposed stub with the full header and prints its path', () => {
    const { repo, e } = activeRepo();
    const r = runLw(repo, ['park', 'Cache the thing'], undefined, e);
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    const name = `${localDate()}-Cache-the-thing.md`;
    expect(out.stub).toBe(`tasks/${name}`);
    expect(out.foundWhile).toBe(A);
    expect(out.blocks).toBe(false);
    const text = readFileSync(join(tasksDir(repo), name), 'utf8');
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^# /);
    expect(text).toMatch(/^kind: feature$/m);
    expect(text).toMatch(/^status: proposed$/m);
    expect(text).toMatch(/^stage: plan$/m);
    expect(text).toMatch(/^plan: draft$/m);
    expect(text).toContain(`found while: ${A}`);
    expect(text).not.toMatch(/^blocks:/m);
    const order = ['kind:', 'status:', 'stage:', 'plan:'].map((k) => text.indexOf(`\n${k}`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toMatch(/^## Goal\s*\n+## Evidence\s*\n*$/m);
  });

  it('--kind fix and --blocks change the header and the printed result', () => {
    const { repo, e } = activeRepo();
    const r = runLw(repo, ['park', 'Broken parser', '--kind', 'fix', '--blocks'], undefined, e);
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.blocks).toBe(true);
    const text = readFileSync(join(repo, '.loopwright', out.stub), 'utf8');
    expect(text).toMatch(/^kind: fix$/m);
    expect(text).toContain(`blocks: ${A}`);
    expect(text).toContain(`found while: ${A}`);
  });

  it('appends a follow-up line to an existing Follow-ups section, with [blocking] when set', () => {
    const { repo, e } = activeRepo('# A\n\nstatus: active\n\n## Follow-ups\n- old thing\n\n## Review log\n');
    const one = JSON.parse(runLw(repo, ['park', 'First'], undefined, e).stdout);
    const two = JSON.parse(runLw(repo, ['park', 'Second', '--blocks'], undefined, e).stdout);
    const text = readFileSync(join(repo, '.loopwright', A), 'utf8');
    expect(text).toContain(`- First — ${one.stub}\n`);
    expect(text).toContain(`- Second — ${two.stub} [blocking]\n`);
    const fu = text.indexOf('## Follow-ups');
    expect(text.indexOf('- old thing')).toBeGreaterThan(fu);
    expect(text.indexOf('- First')).toBeGreaterThan(text.indexOf('- old thing'));
    expect(text.indexOf('- First')).toBeLessThan(text.indexOf('## Review log'));
    expect(text.indexOf('- Second')).toBeLessThan(text.indexOf('## Review log'));
  });

  it('creates a Follow-ups section at the end when missing', () => {
    const { repo, e } = activeRepo('# A\n\nstatus: active\n\n## Goal\nx\n');
    const out = JSON.parse(runLw(repo, ['park', 'Later'], undefined, e).stdout);
    const text = readFileSync(join(repo, '.loopwright', A), 'utf8');
    expect(text.indexOf('## Goal')).toBeLessThan(text.indexOf('## Follow-ups'));
    expect(text.split('## Follow-ups')[1]).toContain(`- Later — ${out.stub}`);
    expect(text.match(/## Follow-ups/g)).toHaveLength(1);
  });

  it('leaves the worktree state file byte-identical', () => {
    const { repo, e } = activeRepo();
    const files = stateFiles(repo);
    expect(files.length).toBeGreaterThan(0);
    const before = files.map((f) => readFileSync(join(repo, '.loopwright/state', f)));
    expect(runLw(repo, ['park', 'No state change'], undefined, e).code).toBe(0);
    expect(stateFiles(repo)).toEqual(files);
    const after = files.map((f) => readFileSync(join(repo, '.loopwright/state', f)));
    after.forEach((b, i) => expect(b.equals(before[i]!)).toBe(true));
  });

  it('with no active task writes a stub without found while and creates .loopwright', () => {
    const repo = makeBareRepo();
    const r = runLw(repo, ['park', 'Lonely'], undefined, env());
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.foundWhile).toBeNull();
    expect(out.blocks).toBe(false);
    const text = readFileSync(join(repo, '.loopwright', out.stub), 'utf8');
    expect(text).toMatch(/^status: proposed$/m);
    expect(text).not.toMatch(/found while/);
    expect(listTasks(repo)).toEqual([out.stub.replace('tasks/', '')]);
  });

  it('with no active task leaves other existing task files unchanged', () => {
    const repo = makeRepo();
    const other = join(tasksDir(repo), 'other.md');
    writeFileSync(other, '# other\n\n## Follow-ups\n');
    expect(runLw(repo, ['park', 'Solo'], undefined, env()).code).toBe(0);
    expect(readFileSync(other, 'utf8')).toBe('# other\n\n## Follow-ups\n');
  });

  it('names files by the plan rule: casing kept, spaces to dashes, only unsafe characters replaced', () => {
    const { repo, e } = activeRepo();
    const out = JSON.parse(runLw(repo, ['park', 'Fix A/B: why? "x" <y>|z*\\w'], undefined, e).stdout);
    const name = out.stub.replace(/^tasks\//, '');
    expect(name.startsWith(`${localDate()}-Fix-`)).toBe(true);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).not.toContain(' ');
    const ok = JSON.parse(runLw(repo, ['park', 'Keep CamelCase_and.dots (ok)'], undefined, e).stdout);
    expect(ok.stub).toBe(`tasks/${localDate()}-Keep-CamelCase_and.dots-(ok).md`);
  });

  it('a repeated title gets -2 and leaves the first file untouched', () => {
    const { repo, e } = activeRepo();
    const first = JSON.parse(runLw(repo, ['park', 'Same'], undefined, e).stdout);
    const firstPath = join(repo, '.loopwright', first.stub);
    writeFileSync(firstPath, readFileSync(firstPath, 'utf8') + '\nhand edit\n');
    const snapshot = readFileSync(firstPath, 'utf8');
    const second = JSON.parse(runLw(repo, ['park', 'Same'], undefined, e).stdout);
    expect(first.stub).toBe(`tasks/${localDate()}-Same.md`);
    expect(second.stub).toBe(`tasks/${localDate()}-Same-2.md`);
    expect(readFileSync(firstPath, 'utf8')).toBe(snapshot);
    const third = JSON.parse(runLw(repo, ['park', 'Same'], undefined, e).stdout);
    expect(third.stub).toBe(`tasks/${localDate()}-Same-3.md`);
  });

  it.each([
    ['no title', ['park'], /usage: park/],
    ['unknown kind', ['park', 'T', '--kind', 'chore'], /park[\s\S]*feature[\s\S]*fix|feature[\s\S]*fix[\s\S]*park/],
  ])('%s exits 1 and writes nothing', (_n, args, message) => {
    const { repo, e } = activeRepo();
    const tasks = listTasks(repo);
    const a = readFileSync(join(repo, '.loopwright', A), 'utf8');
    const r = runLw(repo, args, undefined, e);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(message);
    expect(listTasks(repo)).toEqual(tasks);
    expect(readFileSync(join(repo, '.loopwright', A), 'utf8')).toBe(a);
  });

  it('--blocks with no active task exits 1 and writes nothing', () => {
    const repo = makeBareRepo();
    const r = runLw(repo, ['park', 'T', '--blocks'], undefined, env());
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/park/);
    expect(r.stderr).toMatch(/active task/);
    expect(listTasks(repo)).toEqual([]);
  });

  it('is listed in the usage string', () => {
    const r = runLw(makeRepo(), ['bogus-command']);
    expect(r.stderr).toContain('park');
  });

  it('works under LOOPWRIGHT_HOOKS=off', () => {
    const { repo, e } = activeRepo();
    const r = runLw(repo, ['park', 'Quiet'], undefined, { ...e, LOOPWRIGHT_HOOKS: 'off' });
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(existsSync(join(repo, '.loopwright', out.stub))).toBe(true);
    expect(out.foundWhile).toBe(A);
  });

  it('with the active task file missing writes the stub, reports null and a warning, changes nothing else', () => {
    const { repo, e } = activeRepo();

    unlinkSync(join(repo, '.loopwright', A));
    const stateBefore = stateFiles(repo).map((f) => readFileSync(join(repo, '.loopwright/state', f), 'utf8'));
    const r = runLw(repo, ['park', 'Orphan'], undefined, e);
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.foundWhile).toBeNull();
    expect(`${r.stderr}${r.stdout}`).toMatch(/warn/i);
    expect(existsSync(join(repo, '.loopwright', out.stub))).toBe(true);
    expect(existsSync(join(repo, '.loopwright', A))).toBe(false);
    expect(listTasks(repo)).toEqual([out.stub.replace('tasks/', '')]);
    expect(stateFiles(repo).map((f) => readFileSync(join(repo, '.loopwright/state', f), 'utf8'))).toEqual(stateBefore);
  });
});
