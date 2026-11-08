import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempGitRepo, runCli, readJson } from './helpers.js';

const root = join(__dirname, '..');

describe('cli', () => {
  it('prints help', () => {
    const r = runCli(createTempGitRepo(), ['--help']);
    expect(r.exitCode).toBe(0);
    for (const s of ['loopwright init', 'update', 'uninstall', '--global', '--no-hook', '--no-symlink', '--dry-run', '--force']) {
      expect(r.stdout).toContain(s);
    }
  });

  it('prints version', () => {
    const r = runCli(createTempGitRepo(), ['--version']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(readJson(join(root, 'package.json')).version);
  });

  it('rejects unknown command', () => {
    const r = runCli(createTempGitRepo(), ['frobnicate']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Unknown command');
  });

  it('dist starts with shebang', () => {
    const first = readFileSync(join(root, 'dist', 'cli.js'), 'utf8').split('\n')[0];
    expect(first).toBe('#!/usr/bin/env node');
  });
});
