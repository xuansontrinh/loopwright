import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LW } from './helpers.js';

describe('lw.mjs usage text', () => {
  it('lists every command the state tool handles', () => {
    const src = readFileSync(LW, 'utf8');
    const handled = [...src.matchAll(/^ {4}case '([a-z-]+)':/gm)].map((m) => m[1]);
    const usage = src.match(/usage: lw\.mjs <([^>]+)>/)?.[1]?.split('|') ?? [];
    expect(handled.length).toBeGreaterThan(10);
    expect([...usage].sort()).toEqual([...handled].sort());
  });
});
