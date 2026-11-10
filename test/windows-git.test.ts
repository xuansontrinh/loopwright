import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { gitTopLevel } from '../src/core/git.js';

const LIB = resolve(__dirname, '../content/hooks/lib.mjs');
const oldPath = process.env.PATH;
const dirs: string[] = [];

/** Put a fake `git` first on PATH that prints `top` for every call. */
function fakeGit(top: string): void {
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'lw-fakegit-')));
  dirs.push(bin);
  const f = join(bin, 'git');
  writeFileSync(f, `#!/bin/sh\nprintf '%s\\n' '${top}'\n`);
  chmodSync(f, 0o755);
  process.env.PATH = `${bin}:${oldPath}`;
}

afterEach(() => {
  process.env.PATH = oldPath;
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

// Git on Windows prints forward-slash paths; resolve() normalises them to the platform form.
describe.skipIf(process.platform === 'win32')('AC10: gitTopLevel resolves git-returned paths', () => {
  const raw = '/lw-x/a/../repo/';
  it('AC10: src/core/git.ts gitTopLevel returns a path.resolve d path', () => {
    fakeGit(raw);
    expect(gitTopLevel('/')).toBe(resolve(raw));
  });

  it('AC10: content/hooks/lib.mjs gitTopLevel returns a path.resolve d path', async () => {
    fakeGit(raw);
    const lib = await import(pathToFileURL(LIB).href);
    expect(lib.gitTopLevel('/')).toBe(resolve(raw));
  });
});
