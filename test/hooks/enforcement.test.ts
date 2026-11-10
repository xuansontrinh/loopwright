import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, isolatedEnv, loadFixture, makeRepo, runLw } from './helpers.js';

const HOOKS = resolve(__dirname, '../../content/hooks');
const FIX = resolve(__dirname, '../fixtures/hooks');
const TASK = 'tasks/2026-11-08-x.md';
const TOOLS = ['claude', 'codex'] as const;

function payload(tool: string, kind: string, repo: string, edit?: (p: any) => void): string {
  const p = loadFixture(join(FIX, `${tool}-${kind}.json`), repo);
  edit?.(p);
  return JSON.stringify(p);
}

function run(script: string, tool: string, input: string, cwd: string, env?: Record<string, string>) {
  const t0 = Date.now();
  const r = spawnSync('node', [join(HOOKS, script), '--tool', tool], {
    cwd,
    input,
    encoding: 'utf8',
    env: isolatedEnv(env),
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - t0 };
}

function setup(stage: string, locked = true): string {
  const repo = makeRepo();
  writeFileSync(
    join(repo, '.loopwright/tasks/2026-11-08-x.md'),
    '# Title\n\n## Goal\n\nShip the widget.\n\n## Decisions\n\n- D1: use sqlite\n- D2: no cache\n\nOther line.\n',
  );
  runLw(repo, ['start', TASK]);
  runLw(repo, ['stage', 'test']);
  if (locked) {
    mkdirSync(join(repo, 'test'));
    writeFileSync(join(repo, 'test/t.test.ts'), 'x');
    runLw(repo, ['lock', 'test/t.test.ts']);
  }
  if (stage !== 'test') runLw(repo, ['stage', stage]);
  return repo;
}

describe.each(TOOLS)('guard-locked-tests (%s)', (tool) => {
  it('guard denies edit of locked test during build', () => {
    const repo = setup('build');
    const r = run('guard-locked-tests.mjs', tool, payload(tool, 'pretooluse', repo), repo);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      'loopwright: test/t.test.ts is a locked acceptance test. Ask the user before changing it.',
    );
  });

  it('guard allows edit of locked test outside build', () => {
    const repo = setup('review');
    const r = run('guard-locked-tests.mjs', tool, payload(tool, 'pretooluse', repo), repo);
    expect(r.code).toBe(0);
  });

  it('guard allows non-locked path', () => {
    const repo = setup('build');
    const input = payload(tool, 'pretooluse', repo, (p) => {
      if (tool === 'claude') p.tool_input.file_path = join(repo, 'src/other.ts');
      else p.tool_input.command = p.tool_input.command.replace('test/t.test.ts', 'src/other.ts');
    });
    expect(run('guard-locked-tests.mjs', tool, input, repo).code).toBe(0);
  });
});

it('guard (codex) denies Delete File and Move to of locked path', () => {
  const repo = setup('build');
  for (const line of ['*** Delete File: test/t.test.ts', '*** Update File: x.ts\n*** Move to: test/t.test.ts']) {
    const input = payload('codex', 'pretooluse', repo, (p) => {
      p.tool_input.command = `*** Begin Patch\n${line}\n*** End Patch\n`;
    });
    expect(run('guard-locked-tests.mjs', 'codex', input, repo).code).toBe(2);
  }
});

describe.each(TOOLS)('stop-gate (%s)', (tool) => {
  it('stop-gate blocks without verdict and allows after pass verdict', () => {
    const repo = setup('build');
    const input = payload(tool, 'stop', repo);
    const r = run('stop-gate.mjs', tool, input, repo);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      'loopwright: no passing review for the current code. Run /loopwright-review (or finish the fix loop) before stopping.',
    );
    const s = JSON.parse(runLw(repo, ['status']).stdout);
    expect(s.stopBlocks).toBe(1);
    expect(s.history.at(-1)).toMatchObject({ event: 'stop-blocked', detail: '1' });
    runLw(repo, ['verdict', 'pass', '--round', '1']);
    expect(run('stop-gate.mjs', tool, input, repo).code).toBe(0);
  });

  it('stop-gate blocks when code changed after pass', () => {
    const repo = setup('review');
    runLw(repo, ['verdict', 'pass', '--round', '1']);
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    expect(run('stop-gate.mjs', tool, payload(tool, 'stop', repo), repo).code).toBe(2);
  });

  it('stop-gate allows after 3 blocks with warning', () => {
    const repo = setup('build');
    const input = payload(tool, 'stop', repo);
    for (let i = 0; i < 3; i++) expect(run('stop-gate.mjs', tool, input, repo).code).toBe(2);
    const r = run('stop-gate.mjs', tool, input, repo);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('loopwright: stop-gate limit reached; review gate NOT satisfied.');
  });

  it('stop-gate fails open on corrupt state', () => {
    const repo = setup('build');
    const dir = join(repo, '.loopwright/state');
    const f = JSON.parse(runLw(repo, ['status']).stdout) && readdirSync(dir)[0];
    writeFileSync(join(dir, f), '{not json');
    expect(run('stop-gate.mjs', tool, payload(tool, 'stop', repo), repo).code).toBe(0);
  });

  it('stop-gate allows silently while awaiting the user, and blocks again after resume', () => {
    const repo = setup('review');
    runLw(repo, ['await-user', 'undecided U1']);
    const input = payload(tool, 'stop', repo);
    const r = run('stop-gate.mjs', tool, input, repo);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(JSON.parse(runLw(repo, ['status']).stdout).stopBlocks).toBe(0);
    runLw(repo, ['resume']);
    expect(run('stop-gate.mjs', tool, input, repo).code).toBe(2);
  });

  // Shape captured from a real Claude Code 2.1.319 Stop payload while a backgrounded subagent ran.
  const running = [
    {
      id: 'ae00e15d80a27bba1',
      type: 'subagent',
      status: 'running',
      description: 'Blind review of slice S1',
      agent_type: 'loopwright-reviewer',
    },
  ];

  it('stop-gate allows silently while a background task is running, and blocks again once none is', () => {
    const repo = setup('review');
    const r = run(
      'stop-gate.mjs',
      tool,
      payload(tool, 'stop', repo, (p) => {
        p.background_tasks = running;
      }),
      repo,
    );
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(JSON.parse(runLw(repo, ['status']).stdout).stopBlocks).toBe(0);
    expect(
      run(
        'stop-gate.mjs',
        tool,
        payload(tool, 'stop', repo, (p) => {
          p.background_tasks = [];
        }),
        repo,
      ).code,
    ).toBe(2);
  });

  it('stop-gate ignores background tasks that are no longer running', () => {
    const repo = setup('build');
    const done = [{ ...running[0], status: 'completed' }];
    expect(
      run(
        'stop-gate.mjs',
        tool,
        payload(tool, 'stop', repo, (p) => {
          p.background_tasks = done;
        }),
        repo,
      ).code,
    ).toBe(2);
  });

  it('stop-gate allows in plan stage', () => {
    const repo = setup('test', false);
    expect(run('stop-gate.mjs', tool, payload(tool, 'stop', repo), repo).code).toBe(0);
  });
});

describe.each(TOOLS)('reinject-context (%s)', (tool) => {
  it('reinject prints goal, stage and decisions', () => {
    const repo = setup('build');
    const r = run('reinject-context.mjs', tool, payload(tool, 'compact', repo), repo);
    expect(r.code).toBe(0);
    const text = tool === 'codex' ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : r.stdout;
    if (tool === 'codex') expect(JSON.parse(r.stdout).hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(text).toContain(`loopwright: active task ${TASK}`);
    expect(text).toContain('Ship the widget.');
    expect(text).toContain('Stage: build');
    expect(text).toContain('- D1: use sqlite');
    expect(text).toContain('- D2: no cache');
    expect(text).toContain('Continue /loopwright-build; locked tests must not be edited.');
    expect(text).not.toContain('Other line.');
    expect(text.trim().split('\n').length).toBeLessThanOrEqual(40);
  });

  it('reinject tells the agent it is waiting on the user', () => {
    const repo = setup('build');
    runLw(repo, ['await-user', 'deviation D3']);
    const r = run('reinject-context.mjs', tool, payload(tool, 'compact', repo), repo);
    expect(r.code).toBe(0);
    const text = tool === 'codex' ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : r.stdout;
    expect(text).toContain(
      'Waiting on the user: deviation D3 — do not proceed until they answer; then run lw.mjs resume.',
    );
    expect(text).toContain('Stage: build');
  });

  it('reinject without task file prints header, stage, next step', () => {
    const repo = setup('plan', false);
    const r = run('reinject-context.mjs', tool, payload(tool, 'compact', repo), repo);
    expect(r.stdout).toContain('Stage: plan');
  });
});

describe('no-op and timing', () => {
  const cases: [string, string][] = [
    ['guard-locked-tests.mjs', 'pretooluse'],
    ['stop-gate.mjs', 'stop'],
    ['reinject-context.mjs', 'compact'],
  ];
  it.each(cases)('hooks no-op without active task (%s)', (script, kind) => {
    const repo = makeRepo();
    const r = run(script, 'claude', payload('claude', kind, repo), repo);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it.each(cases)('hooks no-op outside git and without .loopwright (%s)', (script, kind) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lw-nogit-')));
    const r = run(script, 'claude', payload('claude', kind, dir), dir);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it.each(cases)('each hook exits within 1000 ms (%s)', (script, kind) => {
    const repo = setup('build');
    git(repo, ['status']);
    const r = run(script, 'claude', payload('claude', kind, repo), repo);
    expect(r.ms).toBeLessThan(1000);
  });
});

describe('symlink handling', () => {
  it('guard denies edit through a symlinked directory inside the repo', () => {
    const repo = setup('build');
    symlinkSync(join(repo, 'test'), join(repo, 'tlink'));
    const input = payload('claude', 'pretooluse', repo, (p) => {
      p.tool_input.file_path = join(repo, 'tlink/t.test.ts');
    });
    expect(run('guard-locked-tests.mjs', 'claude', input, repo).code).toBe(2);
  });

  it('guard denies when payload cwd is a symlink to the repo (logical absolute path)', () => {
    const repo = setup('build');
    const link = join(realpathSync(mkdtempSync(join(tmpdir(), 'lw-ln-'))), 'logical');
    symlinkSync(repo, link);
    for (const tool of TOOLS) {
      const input = JSON.stringify(JSON.parse(payload(tool, 'pretooluse', link)));
      const r = run('guard-locked-tests.mjs', tool, input, repo);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('loopwright: test/t.test.ts is a locked');
    }
  });

  it('guard resolves a Write to a not-yet-existing path under a symlinked dir', () => {
    const repo = setup('build');
    symlinkSync(join(repo, 'test'), join(repo, 'tlink'));
    const input = payload('claude', 'pretooluse', repo, (p) => {
      p.tool_input.file_path = join(repo, 'tlink/new/deep/file.ts');
    });
    const r = run('guard-locked-tests.mjs', 'claude', input, repo);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
  });
});

describe.each(TOOLS)('LOOPWRIGHT_HOOKS=off (%s)', (tool) => {
  const OFF = { LOOPWRIGHT_HOOKS: 'off' };
  it('every hook exits 0 silently, even where it would block', () => {
    const repo = setup('build');
    const before = runLw(repo, ['status']).stdout;
    for (const [script, kind] of [
      ['stop-gate.mjs', 'stop'],
      ['guard-locked-tests.mjs', 'pretooluse'],
      ['reinject-context.mjs', 'compact'],
    ] as const) {
      const r = run(script, tool, payload(tool, kind, repo), repo, OFF);
      expect(r.code, script).toBe(0);
      expect(r.stdout, script).toBe('');
      expect(r.stderr, script).toBe('');
    }
    expect(runLw(repo, ['status']).stdout).toBe(before);
    // Sanity: without the env var the stop gate blocks.
    expect(run('stop-gate.mjs', tool, payload(tool, 'stop', repo), repo).code).toBe(2);
  });

  it('lw.mjs itself still works with LOOPWRIGHT_HOOKS=off (the reviewer runs check-locks)', () => {
    const repo = setup('build');
    const r = runLw(repo, ['check-locks'], undefined, OFF);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).ok).toBe(true);
  });
});
