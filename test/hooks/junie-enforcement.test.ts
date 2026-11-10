import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveTargets } from '../../src/core/targets.js';
import { hookCommand, hookSpecs } from '../../src/install/hook-wiring.js';
import { isolatedEnv, loadFixture, makeRepo, runLw } from './helpers.js';

const HOOKS = resolve(__dirname, '../../content/hooks');
const FIX = resolve(__dirname, '../fixtures/hooks');
const TASK = 'tasks/2026-11-08-x.md';

// Real Junie payloads (probe A4): cwd is ~/.junie, project_path is the repo.
function payload(kind: string, repo: string, edit?: (p: any) => void): string {
  const p = loadFixture(join(FIX, `junie-${kind}.json`), repo);
  edit?.(p);
  return JSON.stringify(p);
}
const patch = (...lines: string[]) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');
// Hooks run from a directory that is NOT in the repo, like Junie's ~/.junie.
function neutralCwd(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'lw-junie-home-')));
}
function run(script: string, input: string, env?: Record<string, string>) {
  const r = spawnSync('node', [join(HOOKS, script), '--tool', 'junie'], {
    cwd: neutralCwd(),
    input,
    encoding: 'utf8',
    env: isolatedEnv(env),
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
function setup(stage: string): string {
  const repo = makeRepo();
  writeFileSync(
    join(repo, '.loopwright/tasks/2026-11-08-x.md'),
    '# Title\n\n## Goal\n\nShip the widget.\n\n## Decisions\n\n- D1: use sqlite\n\nOther line.\n',
  );
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  mkdirSync(join(repo, 'test'));
  writeFileSync(join(repo, 'test/t.test.ts'), 'x');
  runLw(repo, ['lock', 'test/t.test.ts']);
  if (stage !== 'test') runLw(repo, ['stage', stage]);
  return repo;
}

describe('AC7: hooks with --tool junie', () => {
  it('AC7: guard denies apply_patch touching a locked test during build (path relative to project_path)', () => {
    const repo = setup('build');
    const r = run('guard-locked-tests.mjs', payload('pretooluse', repo));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      'loopwright: test/t.test.ts is a locked acceptance test. Ask the user before changing it.',
    );
  });
  it('AC7: guard denies when the locked file is one of several in the patch', () => {
    const repo = setup('build');
    const input = payload('pretooluse', repo, (p) => {
      p.tool_input.patch = patch('*** Add File: src/new.ts', '+a', '*** Update File: test/t.test.ts', '@@', '-x', '+y');
    });
    expect(run('guard-locked-tests.mjs', input).code).toBe(2);
  });
  it('AC7: guard denies a delete of a locked file', () => {
    const repo = setup('build');
    const input = payload('pretooluse', repo, (p) => {
      p.tool_input.patch = patch('*** Delete File: test/t.test.ts');
    });
    expect(run('guard-locked-tests.mjs', input).code).toBe(2);
  });
  it('AC7: guard allows locked test outside build and non-locked paths', () => {
    expect(run('guard-locked-tests.mjs', payload('pretooluse', setup('review'))).code).toBe(0);
    const repo = setup('build');
    const input = payload('pretooluse', repo, (p) => {
      p.tool_input.patch = patch('*** Add File: src/other.ts', '+a');
    });
    expect(run('guard-locked-tests.mjs', input).code).toBe(0);
    const read = payload('pretooluse', repo, (p) => {
      p.tool_name = 'Read';
      p.tool_input = { file_path: join(repo, 'test/t.test.ts') };
    });
    expect(run('guard-locked-tests.mjs', read).code).toBe(0);
  });
  it('AC7: stop-gate finds the repo from project_path, blocks without verdict, allows after pass', () => {
    const repo = setup('build');
    const input = payload('stop', repo);
    const r = run('stop-gate.mjs', input);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('loopwright: no passing review for the current code.');
    runLw(repo, ['verdict', 'pass', '--round', '1']);
    expect(run('stop-gate.mjs', input).code).toBe(0);
  });
  it('AC7: reinject finds the repo from project_path and prints active task and stage', () => {
    const repo = setup('build');
    const r = run('reinject-context.mjs', payload('compact', repo));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('loopwright: active task');
    expect(r.stdout).toContain('Stage: build');
  });
  it('AC7: fails open on garbage input and under LOOPWRIGHT_HOOKS=off', () => {
    const repo = setup('build');
    for (const s of ['guard-locked-tests.mjs', 'stop-gate.mjs', 'reinject-context.mjs']) {
      expect(run(s, '{not json').code, s).toBe(0);
    }
    const r = run('guard-locked-tests.mjs', payload('pretooluse', repo), { LOOPWRIGHT_HOOKS: 'off' });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
  });
});

describe('AC7: junie hook wiring', () => {
  it('AC7: hookSpecs(junie) matches apply_patch for the guard', () => {
    const specs = hookSpecs('junie' as any);
    const guard = specs.find((s) => s.script === 'guard-locked-tests.mjs');
    expect(guard?.event).toBe('PreToolUse');
    expect(typeof guard?.matcher).toBe('string');
    const re = new RegExp(guard!.matcher as string);
    expect(re.test('apply_patch')).toBe(true);
    expect(re.test('Read')).toBe(false);
    expect(re.test('Bash')).toBe(false);
    expect(specs.map((s) => s.script).sort()).toEqual([
      'guard-locked-tests.mjs',
      'reinject-context.mjs',
      'stop-gate.mjs',
    ]);
  });
  it('AC7: hookCommand(junie) uses an absolute script path and no git rev-parse (repo mode)', () => {
    const t = resolveTargets({ mode: 'repo', cwd: makeRepo() } as any);
    const c = hookCommand('junie' as any, t, 'stop-gate.mjs');
    expect(c).toContain(`"${t.lwHome}/hooks/stop-gate.mjs"`);
    expect(c).not.toContain('git rev-parse');
    expect(c).not.toContain('$');
    expect(c).toMatch(/--tool junie$/);
  });
  it('AC7: hookCommand(junie) uses an absolute path in global mode', () => {
    const t = resolveTargets({ mode: 'global', home: '/tmp/h/' } as any);
    const c = hookCommand('junie' as any, t, 'stop-gate.mjs');
    expect(c).toContain(`"${t.lwHome}/hooks/stop-gate.mjs"`);
    expect(c).toMatch(/--tool junie$/);
  });
});
