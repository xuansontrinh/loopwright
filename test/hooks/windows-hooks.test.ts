import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { isolatedEnv, makeRepo, runLw } from './helpers.js';

const HOOKS = resolve(__dirname, '../../content/hooks');
const LIB_URL = pathToFileURL(join(HOOKS, 'lib.mjs')).href;
const TASK = 'tasks/2026-11-10-w.md';
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('AC11: repoRelative is case-insensitive on win32', () => {
  it('AC11: Test/T.test.ts and test/t.test.ts map to the same key on win32', async () => {
    const repo = makeRepo();
    const lib = await import(LIB_URL);
    expect(lib.repoRelative(repo, 'Test/T.test.ts', 'win32')).toBe(lib.repoRelative(repo, 'test/t.test.ts', 'win32'));
  });

  it('AC11: case still matters on linux', async () => {
    const repo = makeRepo();
    const lib = await import(LIB_URL);
    expect(lib.repoRelative(repo, 'Test/T.test.ts', 'linux')).not.toBe(
      lib.repoRelative(repo, 'test/t.test.ts', 'linux'),
    );
    expect(lib.repoRelative(repo, 'Test/T.test.ts', 'linux')).toBe('Test/T.test.ts');
  });
});

describe('AC12: reinject-context handles CRLF task files', () => {
  it('AC12: output has no carriage returns and keeps goal and decisions', () => {
    const repo = makeRepo();
    const body = '# Title\n\n## Goal\n\nShip the widget.\n\n## Decisions\n\n- D1: use sqlite\n- D2: no cache\n';
    writeFileSync(join(repo, '.loopwright', TASK), body.replace(/\n/g, '\r\n'));
    runLw(repo, ['start', TASK]);
    const input = JSON.stringify({ cwd: repo, hook_event_name: 'SessionStart', source: 'compact' });
    const r = spawnSync('node', [join(HOOKS, 'reinject-context.mjs'), '--tool', 'claude'], {
      cwd: repo,
      input,
      encoding: 'utf8',
      env: isolatedEnv(),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Ship the widget.');
    expect(r.stdout).toContain('- D1: use sqlite');
    expect(r.stdout).not.toContain('\r');
  });
});

describe('AC13: writeState retries renameSync on EPERM', () => {
  function drive(failures: number) {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'lw-ws-')));
    dirs.push(tmp);
    const preload = join(tmp, 'preload.mjs');
    writeFileSync(
      preload,
      `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const real = fs.renameSync; let n = 0;
fs.renameSync = (a, b) => { if (n++ < ${failures}) { const e = new Error('EPERM: operation not permitted, rename'); e.code = 'EPERM'; throw e; } return real(a, b); };
syncBuiltinESMExports();
`,
    );
    const driver = join(tmp, 'driver.mjs');
    writeFileSync(
      driver,
      `import { writeState } from ${JSON.stringify(LIB_URL)};\nwriteState(${JSON.stringify(tmp)}, 'abc', { a: 1 });\n`,
    );
    const r = spawnSync('node', ['--import', pathToFileURL(preload).href, driver], {
      encoding: 'utf8',
      timeout: 20000,
    });
    return { r, file: join(tmp, 'state', 'abc.json') };
  }

  it('AC13: transient EPERM is retried and the state file is written', () => {
    const { r, file } = drive(2);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 1 });
  });

  it('AC13: persistent EPERM eventually throws', () => {
    const { r } = drive(1_000_000);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('EPERM');
  });
});
