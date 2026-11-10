import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { InstallWriter } from '../src/core/writer.js';
import { sha256, readManifest, writeManifest, type Manifest } from '../src/core/manifest.js';

let root: string;
let asked: string[];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'writer-'));
  asked = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function make(opts: { manifest?: Manifest | null; dryRun?: boolean; force?: boolean; answer?: boolean } = {}) {
  return new InstallWriter({
    manifest: opts.manifest ?? null,
    dryRun: opts.dryRun ?? false,
    force: opts.force ?? false,
    confirm: async (q) => {
      asked.push(q);
      return opts.answer ?? false;
    },
    toKey: (abs) => relative(root, abs).split('\\').join('/'),
  });
}
const manifestFor = (path: string, content: string): Manifest => ({
  version: 1,
  mode: 'repo',
  files: [{ path, sha256: sha256(content) }],
  config: [],
});

describe('InstallWriter', () => {
  it('creates new file', async () => {
    const f = join(root, 'a/b/c.md');
    expect(await make().writeFile(f, 'x')).toBe('created');
    expect(readFileSync(f, 'utf-8')).toBe('x');
  });

  it('unchanged when identical', async () => {
    const f = join(root, 'c.md');
    writeFileSync(f, 'x');
    expect(await make().writeFile(f, 'x')).toBe('unchanged');
  });

  it('updates file untouched since last install', async () => {
    const f = join(root, 'c.md');
    writeFileSync(f, 'old');
    const w = make({ manifest: manifestFor('c.md', 'old') });
    expect(await w.writeFile(f, 'new')).toBe('updated');
    expect(readFileSync(f, 'utf-8')).toBe('new');
    expect(asked).toEqual([]);
  });

  it('keeps user-edited file when declined', async () => {
    const f = join(root, 'c.md');
    writeFileSync(f, 'edited');
    const w = make({ manifest: manifestFor('c.md', 'old'), answer: false });
    expect(await w.writeFile(f, 'new')).toBe('kept');
    expect(readFileSync(f, 'utf-8')).toBe('edited');
    expect(asked).toEqual([`${f} was modified. Overwrite?`]);
  });

  it('overwrites user-edited file with force', async () => {
    const f = join(root, 'c.md');
    writeFileSync(f, 'edited');
    const w = make({ manifest: manifestFor('c.md', 'old'), force: true });
    expect(await w.writeFile(f, 'new')).toBe('updated');
    expect(readFileSync(f, 'utf-8')).toBe('new');
    expect(asked).toEqual([]);
  });

  it('dry run writes nothing and does not prompt', async () => {
    const w = make({ dryRun: true });
    const created = join(root, 'new/n.md');
    const edited = join(root, 'e.md');
    writeFileSync(edited, 'edited');
    expect(await w.writeFile(created, 'x')).toBe('created');
    expect(await w.writeFile(edited, 'new')).toBe('kept');
    expect(existsSync(created)).toBe(false);
    expect(existsSync(join(root, 'new'))).toBe(false);
    expect(readFileSync(edited, 'utf-8')).toBe('edited');
    expect(asked).toEqual([]);
  });

  it('result() lists written/unchanged files; kept files without prior entry are omitted', async () => {
    mkdirSync(join(root, 'd'));
    writeFileSync(join(root, 'same.md'), 's');
    writeFileSync(join(root, 'kept.md'), 'mine');
    const w = make({ answer: false });
    await w.writeFile(join(root, 'new.md'), 'n');
    await w.writeFile(join(root, 'same.md'), 's');
    await w.writeFile(join(root, 'kept.md'), 'theirs');
    w.recordConfig({ file: join(root, '.claude/settings.json'), kind: 'claude-hooks' });
    w.recordConfig({ file: join(root, '.claude/settings.json'), kind: 'claude-hooks' });
    const m = w.result();
    expect(m).toEqual({
      version: 1,
      mode: 'repo',
      files: [
        { path: 'new.md', sha256: sha256('n') },
        { path: 'same.md', sha256: sha256('s') },
      ],
      config: [{ file: '.claude/settings.json', kind: 'claude-hooks' }],
    });
  });

  it('result() keeps the prior hash for a declined file', async () => {
    const f = join(root, 'k.md');
    writeFileSync(f, 'mine');
    const w = make({ manifest: manifestFor('k.md', 'old'), answer: false });
    expect(await w.writeFile(f, 'new')).toBe('kept');
    expect(w.result().files).toEqual([{ path: 'k.md', sha256: sha256('old') }]);
  });

  it('result() carries forward prior entries for files not written this run', async () => {
    const prior: Manifest = {
      version: 1,
      mode: 'repo',
      config: [],
      files: [
        { path: 'gone.md', sha256: sha256('old') },
        { path: 'a.md', sha256: sha256('a0') },
      ],
    };
    const w = make({ manifest: prior });
    writeFileSync(join(root, 'a.md'), 'a0');
    await w.writeFile(join(root, 'a.md'), 'a1');
    expect(w.result().files).toEqual([
      { path: 'a.md', sha256: sha256('a1') },
      { path: 'gone.md', sha256: sha256('old') },
    ]);
  });

  it('manifest round-trips', () => {
    const p = join(root, 'x/m.json');
    const m = manifestFor('a', 'b');
    writeManifest(p, m);
    expect(readFileSync(p, 'utf-8').endsWith('\n')).toBe(true);
    expect(readManifest(p)).toEqual(m);
    expect(readManifest(join(root, 'none.json'))).toBeNull();
  });
});
