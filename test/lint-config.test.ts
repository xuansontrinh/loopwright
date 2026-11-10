import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (script: string) =>
  spawnSync(npm, ['run', script], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });

describe('AC15: format scripts', () => {
  it('AC15: package.json has format and format:check scripts', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.format).toMatch(/prettier.*--write/);
    expect(pkg.scripts['format:check']).toMatch(/prettier.*--check/);
  });

  it('AC15: ci.yml runs format:check before tests', () => {
    const ci = read('.github/workflows/ci.yml');
    const fmt = ci.indexOf('npm run format:check');
    const test = ci.indexOf('npm test');
    expect(fmt).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(fmt);
  });
});

describe('AC16: prettier config, no ESLint', () => {
  it('AC16: .prettierrc exists with single quotes, semicolons, trailing commas, width 120', () => {
    expect(existsSync(join(root, '.prettierrc'))).toBe(true);
    const cfg = JSON.parse(read('.prettierrc'));
    expect(cfg.singleQuote).toBe(true);
    expect(cfg.semi).toBe(true);
    expect(cfg.trailingComma).toBe('all');
    expect(cfg.printWidth).toBe(120);
  });

  it('AC16: npm run format:check exits 0', () => {
    const r = run('format:check');
    expect(r.status, r.stdout + r.stderr).toBe(0);
  }, 120_000);

  it('AC16: no eslint config, lint script or ESLint dependency exists', () => {
    for (const f of [
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs',
      'eslint.config.ts',
      '.eslintrc',
      '.eslintrc.json',
      '.eslintrc.js',
    ]) {
      expect(existsSync(join(root, f)), f).toBe(false);
    }
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.lint).toBeUndefined();
    for (const s of Object.values<string>(pkg.scripts)) expect(s).not.toMatch(/eslint/);
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.keys(pkg.overrides ?? {}),
    ];
    expect(names.filter((n) => /eslint/i.test(n))).toEqual([]);
  });

  it('AC16: ci.yml does not run lint', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/npm run lint|eslint/);
  });
});

describe('AC17: ignores', () => {
  const dirs = ['dist', '.loopwright', 'research', '.claude', '.codex', '.junie', 'node_modules'];

  it('AC17: .prettierignore lists generated and local dirs and AGENTS.md', () => {
    expect(existsSync(join(root, '.prettierignore'))).toBe(true);
    const s = read('.prettierignore');
    for (const d of [...dirs, 'AGENTS.md']) expect(s, d).toMatch(new RegExp(`^/?${d.replace('.', '\\.')}/?\\s*$`, 'm'));
  });

  it('AC17: AGENTS.md is still a symlink after format:check', () => {
    run('format:check');
    expect(lstatSync(join(root, 'AGENTS.md')).isSymbolicLink()).toBe(true);
  }, 120_000);
});
