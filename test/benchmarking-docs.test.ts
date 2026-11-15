import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'bench', 'fixture');

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return testFiles(p);
    return /\.test\.[cm]?js$/.test(name) ? [p] : [];
  });
}

describe('benchmarking docs', () => {
  it('gives the report commands, the answer sheet and the fixture', () => {
    const doc = readFileSync(join(root, 'docs', 'benchmarking.md'), 'utf8');
    expect(doc).toContain('node scripts/usage-report.mjs');
    expect(doc).toContain('--json');
    expect(doc).toContain('## Answer sheet');
    expect(doc).toContain('bench/fixture');
  });

  it('is linked from the dogfood checklist and not from the README', () => {
    expect(readFileSync(join(root, 'docs', 'dogfood-checklist.md'), 'utf8')).toContain('benchmarking.md');
    expect(readFileSync(join(root, 'README.md'), 'utf8')).not.toContain('benchmarking.md');
  });
});

describe('benchmark fixture', () => {
  it('is a zero-dependency project with a node:test file', () => {
    const pkg = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'));
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.devDependencies ?? {}).toEqual({});
    expect(existsSync(join(fixture, 'node_modules'))).toBe(false);
    expect(testFiles(fixture).length).toBeGreaterThan(0);
  });

  it('passes its own node --test run', () => {
    const r = spawnSync(process.execPath, ['--test'], { cwd: fixture, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
