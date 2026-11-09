import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILES } from '../../src/core/profiles.js';
import { DEFAULT_CONFIG } from '../../src/core/config.js';
import { makeRepo, runLw } from './helpers.js';

const TASK = 'tasks/2026-11-09-x.md';
const ROLES = ['scout', 'tester', 'implementer', 'reviewer'] as const;

function setup(opts: { config?: object; header?: string; manifestProfile?: string }): string {
  const repo = makeRepo();
  if (opts.manifestProfile) {
    const mp = join(repo, '.loopwright/manifest.json');
    const m = existsSync(mp) ? JSON.parse(readFileSync(mp, 'utf8')) : { files: {} };
    m.options = { ...(m.options ?? {}), hook: true, symlink: true, profile: opts.manifestProfile };
    writeFileSync(mp, JSON.stringify(m));
  }
  if (opts.config) writeFileSync(join(repo, '.loopwright/config.json'), JSON.stringify(opts.config));
  writeFileSync(join(repo, '.loopwright', TASK), `# T\n\nstatus: active\nstage: plan\n${opts.header ? opts.header + '\n' : ''}\n## Goal\n\nx\n`);
  expect(runLw(repo, ['start', TASK]).code).toBe(0);
  return repo;
}

describe('AC5: lw.mjs effort', () => {
  it('AC5: task profile header wins over the manifest profile', () => {
    const repo = setup({ manifestProfile: 'lean', header: 'profile: deep' });
    for (const r of ROLES) expect(runLw(repo, ['effort', r]).stdout.trim()).toBe((PROFILES as any).deep[r]);
  });
  it('AC5: falls back to the manifest recorded profile', () => {
    const repo = setup({ manifestProfile: 'thorough' });
    expect(runLw(repo, ['effort', 'scout']).stdout.trim()).toBe('high');
    expect(runLw(repo, ['effort', 'reviewer']).stdout.trim()).toBe('xhigh');
  });
  it('AC5: a config.json profile key is ignored', () => {
    const repo = setup({ config: { profile: 'deep' } });
    expect(runLw(repo, ['effort', 'scout']).stdout.trim()).toBe('medium');
  });
  it('AC5: no header and no manifest profile is balanced', () => {
    const repo = setup({ config: {} });
    expect(runLw(repo, ['effort', 'tester']).stdout.trim()).toBe('medium');
    expect(runLw(repo, ['effort', 'reviewer']).stdout.trim()).toBe('high');
  });
  it('AC5: mirrored table in content/hooks equals PROFILES', async () => {
    const mod: any = await import(resolve(__dirname, '../../content/hooks/lib.mjs')).catch(() => ({}));
    const mirrored = mod.PROFILES ?? (await import(resolve(__dirname, '../../content/hooks/lw.mjs')).catch(() => ({}))).PROFILES;
    expect(mirrored).toEqual(PROFILES);
  });
  it('AC8: default-config.json has no effort maps', () => {
    const j = JSON.parse(readFileSync(resolve(__dirname, '../../content/hooks/default-config.json'), 'utf8'));
    for (const t of ['claude', 'codex', 'junie', 'crossAgentReviewer']) expect(j.models[t].effort).toBeUndefined();
  });
  it('AC8: scaffolded config.json (lw start) carries no effort maps and effort still resolves to balanced', () => {
    const repo = setup({});
    const j = JSON.parse(readFileSync(join(repo, '.loopwright/config.json'), 'utf8'));
    for (const t of ['claude', 'junie', 'crossAgentReviewer']) expect(j.models?.[t]?.effort).toBeUndefined();
    expect(runLw(repo, ['effort', 'scout']).stdout.trim()).toBe('medium');
  });
  it('AC5: default-config.json equals DEFAULT_CONFIG', () => {
    expect(JSON.parse(readFileSync(resolve(__dirname, '../../content/hooks/default-config.json'), 'utf8'))).toEqual(DEFAULT_CONFIG);
  });
});
