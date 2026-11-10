import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mainWorktreeRoot } from '../src/core/git.js';

const LIB = resolve(__dirname, '../content/hooks/lib.mjs');
const oldPath = process.env.PATH;
const dirs: string[] = [];

/** Fake `git` on PATH that prints `out` for every call. */
function fakeGit(out: string): void {
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'lw-fakegit-')));
  dirs.push(bin);
  const f = join(bin, 'git');
  writeFileSync(f, `#!/bin/sh\nprintf '%s\\n' '${out}'\n`);
  chmodSync(f, 0o755);
  process.env.PATH = `${bin}:${oldPath}`;
}

afterEach(() => {
  process.env.PATH = oldPath;
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('AC3: mainWorktreeRoot resolves git-returned paths', () => {
  const common = '/lw-x/a/../repo/.git';
  it('AC3: src/core/git.ts mainWorktreeRoot returns a path.resolve d path', () => {
    fakeGit(common);
    expect(mainWorktreeRoot('/')).toBe(resolve('/lw-x/a/../repo'));
  });

  it('AC3: content/hooks/lib.mjs mainWorktreeRoot returns a path.resolve d path', async () => {
    fakeGit(common);
    const lib = await import(pathToFileURL(LIB).href);
    expect(lib.mainWorktreeRoot('/')).toBe(resolve('/lw-x/a/../repo'));
  });
});
