import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { git, makeBareRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-08-x.md';
const emptyHome = () => realpathSync(mkdtempSync(join(tmpdir(), 'lw-home-')));
const homeEnv = (h: string) => ({ HOME: h, USERPROFILE: h });

describe('lw.mjs lazy .loopwright creation', () => {
  it('content/hooks/default-config.json equals DEFAULT_CONFIG', () => {
    const json = JSON.parse(readFileSync(resolve(__dirname, '../../content/hooks/default-config.json'), 'utf8'));
    expect(json).toEqual(DEFAULT_CONFIG);
  });

  it('dir prints null when .loopwright is absent', () => {
    const repo = makeBareRepo();
    const r = runLw(repo, ['dir']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('null');
    expect(existsSync(join(repo, '.loopwright'))).toBe(false);
  });

  it('status without .loopwright inside git reports no active task', () => {
    const repo = makeBareRepo();
    const r = runLw(repo, ['status']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no active task');
    expect(existsSync(join(repo, '.loopwright'))).toBe(false);
  });

  it('start scaffolds .loopwright with self-ignoring .gitignore, tasks/, state/ and default config', () => {
    const repo = makeBareRepo();
    const r = runLw(repo, ['start', TASK], undefined, homeEnv(emptyHome()));
    expect(r.code, r.stderr).toBe(0);
    const lw = join(repo, '.loopwright');
    expect(readFileSync(join(lw, '.gitignore'), 'utf8')).toBe('*\n');
    expect(statSync(join(lw, 'tasks')).isDirectory()).toBe(true);
    expect(statSync(join(lw, 'state')).isDirectory()).toBe(true);
    expect(JSON.parse(readFileSync(join(lw, 'config.json'), 'utf8'))).toEqual(DEFAULT_CONFIG);
    expect(git(repo, ['status', '--porcelain'])).toBe('');
    expect(runLw(repo, ['dir']).stdout.trim()).toBe(lw);
  });

  it('start seeds config.json from ~/.config/loopwright/config.json when present', () => {
    const repo = makeBareRepo();
    const home = emptyHome();
    mkdirSync(join(home, '.config/loopwright'), { recursive: true });
    const mine = '{ "maxFixRounds": 7 }\n';
    writeFileSync(join(home, '.config/loopwright/config.json'), mine);
    expect(runLw(repo, ['start', TASK], undefined, homeEnv(home)).code).toBe(0);
    expect(readFileSync(join(repo, '.loopwright/config.json'), 'utf8')).toBe(mine);
  });

  it('start from a linked worktree scaffolds in the main worktree', () => {
    const repo = makeBareRepo();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'lw-wt-'))), 'wt');
    git(repo, ['worktree', 'add', '-q', '-b', 'feat', wt]);
    expect(runLw(wt, ['start', TASK], undefined, homeEnv(emptyHome())).code).toBe(0);
    expect(existsSync(join(repo, '.loopwright/.gitignore'))).toBe(true);
    expect(existsSync(join(wt, '.loopwright'))).toBe(false);
  });
});
