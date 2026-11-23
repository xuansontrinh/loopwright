import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { hookSpecs } from '../src/install/hook-wiring.js';
import { createTempGitRepo, readJson, runCli } from './helpers.js';

const SCRIPT = 'plain-questions.mjs';
const ASK_HOOK = { event: 'PreToolUse', matcher: 'AskUserQuestion', script: SCRIPT };
const SETTINGS = '.claude/settings.json';
const INSTALLED = `.agents/loopwright/hooks/${SCRIPT}`;

const askEntries = (settings: any): any[] =>
  (settings.hooks?.PreToolUse ?? []).filter((g: any) => g.matcher === 'AskUserQuestion');

describe('question check hook specs', () => {
  it('the Claude Code specs include a PreToolUse hook on AskUserQuestion', () => {
    expect(hookSpecs('claude')).toContainEqual(ASK_HOOK);
  });

  it('the Codex specs are the guard, the stop gate and the compaction restore only', () => {
    expect(hookSpecs('codex')).toEqual([
      { event: 'PreToolUse', matcher: '^apply_patch$', script: 'guard-locked-tests.mjs' },
      { event: 'Stop', script: 'stop-gate.mjs' },
      { event: 'SessionStart', matcher: 'compact', script: 'reinject-context.mjs' },
    ]);
  });

  it('the Junie specs are the guard, the stop gate and the compaction restore only', () => {
    expect(hookSpecs('junie')).toEqual(hookSpecs('codex'));
  });
});

describe('question check install lifecycle', () => {
  let repo: string;
  let home: string;
  const run = (args: string[]) => runCli(repo, args, { home });
  beforeEach(() => {
    repo = createTempGitRepo('lw-pq-');
    home = mkdtempSync(join(tmpdir(), 'lw-h-'));
  });

  it('init wires one PreToolUse hook on AskUserQuestion that runs the installed script', () => {
    expect(run(['init']).exitCode).toBe(0);
    const entries = askEntries(readJson(join(repo, SETTINGS)));
    expect(entries).toHaveLength(1);
    expect(entries[0].hooks).toHaveLength(1);
    expect(entries[0].hooks[0].type).toBe('command');
    expect(entries[0].hooks[0].command).toContain(`.agents/loopwright/hooks/${SCRIPT}`);
    expect(entries[0].hooks[0].command).toMatch(/--tool claude$/);
    expect(existsSync(join(repo, INSTALLED))).toBe(true);
  });

  it('a global init wires it to the script in the loopwright home', () => {
    expect(run(['init', '--global', '--force']).exitCode).toBe(0);
    const entries = askEntries(readJson(join(home, SETTINGS)));
    expect(entries).toHaveLength(1);
    expect(entries[0].hooks[0].command).toContain(`/hooks/${SCRIPT}`);
    expect(existsSync(join(home, '.config/loopwright/hooks', SCRIPT))).toBe(true);
  });

  it('the locked-test guard keeps its own matcher next to it', () => {
    expect(run(['init']).exitCode).toBe(0);
    const matchers = readJson(join(repo, SETTINGS)).hooks.PreToolUse.map((g: any) => g.matcher);
    expect(matchers).toContain('Edit|Write|MultiEdit');
    expect(matchers).toContain('AskUserQuestion');
  });

  it('update keeps it, once and unchanged', () => {
    expect(run(['init']).exitCode).toBe(0);
    const before = readFileSync(join(repo, SETTINGS), 'utf8');
    expect(run(['update']).exitCode).toBe(0);
    expect(readFileSync(join(repo, SETTINGS), 'utf8')).toBe(before);
    expect(askEntries(JSON.parse(before))).toHaveLength(1);
  });

  it('update adds it to an install that predates it', () => {
    expect(run(['init']).exitCode).toBe(0);
    const path = join(repo, SETTINGS);
    const settings = readJson(path);
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((g: any) => g.matcher !== 'AskUserQuestion');
    writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
    expect(run(['update']).exitCode).toBe(0);
    expect(askEntries(readJson(path))).toHaveLength(1);
  });

  it('uninstall removes it and the installed script', () => {
    expect(run(['init']).exitCode).toBe(0);
    expect(askEntries(readJson(join(repo, SETTINGS)))).toHaveLength(1);
    expect(existsSync(join(repo, INSTALLED))).toBe(true);
    expect(run(['uninstall']).exitCode).toBe(0);
    const text = readFileSync(join(repo, SETTINGS), 'utf8');
    expect(text).not.toContain(SCRIPT);
    expect(askEntries(JSON.parse(text))).toHaveLength(0);
    expect(existsSync(join(repo, INSTALLED))).toBe(false);
  });

  it('uninstall keeps a hook of the user on the same tool', () => {
    expect(run(['init']).exitCode).toBe(0);
    const path = join(repo, SETTINGS);
    const settings = readJson(path);
    expect(askEntries(settings)).toHaveLength(1);
    const mine = { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: 'echo user-ask' }] };
    settings.hooks.PreToolUse.push(mine);
    writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
    expect(run(['uninstall']).exitCode).toBe(0);
    expect(askEntries(readJson(path))).toEqual([mine]);
  });

  it('Codex and Junie wiring does not mention it', () => {
    expect(run(['init', '--experimental', 'junie-hooks']).exitCode).toBe(0);
    const codex = readFileSync(join(repo, '.codex/config.toml'), 'utf8');
    expect(codex).toContain('guard-locked-tests.mjs');
    expect(codex).not.toContain(SCRIPT);
    expect(codex).not.toContain('AskUserQuestion');
    const junie = readFileSync(join(repo, '.junie/config.json'), 'utf8');
    expect(junie).toContain('guard-locked-tests.mjs');
    expect(junie).not.toContain(SCRIPT);
    expect(junie).not.toContain('AskUserQuestion');
  });
});
