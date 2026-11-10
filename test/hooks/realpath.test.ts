import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const LIB = resolve(__dirname, '../../content/hooks/lib.mjs');
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('realpathResolve', () => {
  it('returns the impl (native) result when it succeeds', async () => {
    const lib = await import(pathToFileURL(LIB).href);
    const seen: string[] = [];
    const out = lib.realpathResolve('/some/where', (p: string) => {
      seen.push(p);
      return '/native/result';
    });
    expect(out).toBe('/native/result');
    expect(seen).toEqual(['/some/where']);
  });

  it('falls back to JS realpathSync when impl throws', async () => {
    const lib = await import(pathToFileURL(LIB).href);
    const dir = mkdtempSync(join(tmpdir(), 'lw-rp-'));
    dirs.push(dir);
    const out = lib.realpathResolve(dir, () => {
      throw new Error('native failed');
    });
    expect(out).toBe(realpathSync(dir));
  });

  it('still throws when both native and JS realpath fail', async () => {
    const lib = await import(pathToFileURL(LIB).href);
    expect(typeof lib.realpathResolve).toBe('function');
    expect(() =>
      lib.realpathResolve(join(tmpdir(), 'lw-does-not-exist-xyz'), () => {
        throw new Error('native failed');
      }),
    ).toThrow();
  });
});
