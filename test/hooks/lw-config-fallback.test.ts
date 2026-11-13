import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { git, makeBareRepo, runLw } from './helpers.js';

describe('config without a main checkout config.json', () => {
  it('prints the default config from a linked worktree and writes nothing', () => {
    const repo = makeBareRepo();
    const wt = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'lw-wt-'))), 'wt');
    git(repo, ['worktree', 'add', '-q', '-b', 'feat', wt]);
    const r = runLw(wt, ['config']);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(DEFAULT_CONFIG);
    expect(git(repo, ['status', '--porcelain', '--ignored'])).not.toContain('.loopwright');
  });
});
