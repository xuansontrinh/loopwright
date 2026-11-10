import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILES, resolveProfile } from '../src/core/profiles.js';
import { DEFAULT_CONFIG, readConfig } from '../src/core/config.js';

const cfg = (obj: unknown) => {
  const p = join(mkdtempSync(join(tmpdir(), 'lw-prof-')), 'config.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
};
const R = ['scout', 'tester', 'implementer', 'reviewer'] as const;
const E = (a: string, b: string, c: string, d: string) => ({ scout: a, tester: b, implementer: c, reviewer: d });
const MATRIX: Record<string, Record<string, string>> = {
  lean: E('low', 'low', 'low', 'medium'),
  balanced: E('medium', 'medium', 'medium', 'high'),
  thorough: E('high', 'high', 'high', 'xhigh'),
  deep: E('xhigh', 'xhigh', 'xhigh', 'xhigh'),
};

describe('AC1: profiles table', () => {
  it('AC1: PROFILES holds the four D3 matrices', () => {
    expect(Object.keys(PROFILES).sort()).toEqual(Object.keys(MATRIX).sort());
    for (const [n, m] of Object.entries(MATRIX)) {
      for (const r of R) expect((PROFILES as any)[n][r]).toBe(m[r]);
    }
  });
  it.each(Object.keys(MATRIX))('AC1: resolveProfile(%s) returns its efforts', (n) => {
    expect(resolveProfile(n)).toMatchObject(MATRIX[n]!);
  });
  it('AC1: resolveProfile throws on unknown name, listing allowed values', () => {
    expect(() => resolveProfile('bogus')).toThrow(/lean/);
    expect(() => resolveProfile('bogus')).toThrow(/deep/);
    expect(() => resolveProfile('bogus')).toThrow(/bogus/);
  });
});

describe('AC2: readConfig(path, profile)', () => {
  it.each(Object.keys(MATRIX))('AC2: profile %s applies to claude, junie, codex and cross-agent reviewer', (n) => {
    const c = readConfig(cfg({}), n) as any;
    expect(c.models.claude.effort).toEqual(MATRIX[n]);
    expect(c.models.junie.effort).toEqual(MATRIX[n]);
    expect(c.models.codex.effort).toEqual(MATRIX[n]);
    expect(c.models.crossAgentReviewer.effort.claude).toBe(MATRIX[n]!.reviewer);
  });
  it('AC2: per-role effort keys in the file are ignored, even invalid ones', () => {
    const file = {
      models: {
        claude: { effort: { scout: 'bogus' } },
        junie: { effort: { reviewer: 'nonsense' } },
        codex: { effort: { scout: 'bogus', reviewer: 'nonsense' } },
        crossAgentReviewer: { effort: { claude: 'bogus' } },
      },
    };
    for (const prof of ['deep', 'lean', undefined]) {
      const c = readConfig(cfg(file), prof) as any;
      const want = MATRIX[prof ?? 'balanced']!;
      expect(c.models.claude.effort).toEqual(want);
      expect(c.models.junie.effort).toEqual(want);
      expect(c.models.codex.effort).toEqual(want);
      expect(c.models.crossAgentReviewer.effort).toEqual({ claude: want.reviewer });
    }
  });
  it('AC2: profile applies to a missing config file', () => {
    expect((readConfig('/nonexistent/config.json', 'lean') as any).models.junie.effort.reviewer).toBe('medium');
  });
  it('AC2: no profile equals today defaults (balanced)', () => {
    const c = readConfig(cfg({})) as any;
    expect(c.models.claude.effort).toEqual(MATRIX.balanced);
    expect(c.models.junie.effort).toEqual(MATRIX.balanced);
    expect(c.models.codex.effort).toEqual(MATRIX.balanced);
    expect(c.models.crossAgentReviewer.effort).toEqual({ claude: 'high' });
  });
  it('AC2: profile does not change codex models; a codex effort key (even invalid) is ignored', () => {
    const c = readConfig(
      cfg({ models: { codex: { reviewer: 'gpt-x', effort: { reviewer: 'bogus' } } } }),
      'thorough',
    ) as any;
    expect(c.models.codex.reviewer).toBe('gpt-x');
    expect(c.models.codex.scout).toBe(DEFAULT_CONFIG.models.codex.scout);
    expect(c.models.codex.effort).toEqual(MATRIX.thorough);
    expect((readConfig(cfg({}), 'deep') as any).models.codex.tester).toBe(DEFAULT_CONFIG.models.codex.tester);
  });
  it('AC2: unknown profile argument throws naming allowed values', () => {
    expect(() => readConfig(cfg({}), 'bogus')).toThrow(/bogus/);
    expect(() => readConfig(cfg({}), 'bogus')).toThrow(/thorough/);
  });
  it('AC2: a profile key in config.json is not read (no config key)', () => {
    const c = readConfig(cfg({ profile: 'deep' })) as any;
    expect(c.models.claude.effort).toEqual(MATRIX.balanced);
    expect(() => readConfig(cfg({ profile: 'bogus' }))).not.toThrow();
  });
  it('AC2: profile does not change models', () => {
    const c = readConfig(cfg({}), 'deep') as any;
    expect(c.models.claude.scout).toBe(DEFAULT_CONFIG.models.claude.scout);
    expect(c.models.junie.reviewer).toBe(DEFAULT_CONFIG.models.junie.reviewer);
  });
});

describe('AC8: defaults carry no efforts; config efforts are explicit', () => {
  const noEffort = (c: any) => {
    expect(c.models.claude.effort).toBeUndefined();
    expect(c.models.junie.effort).toBeUndefined();
    expect(c.models.codex.effort).toBeUndefined();
    expect(c.models.crossAgentReviewer.effort).toBeUndefined();
  };
  it('AC8: DEFAULT_CONFIG has no per-role effort maps', () => {
    noEffort(DEFAULT_CONFIG);
  });
  it('AC8: default-config.json has no effort maps and equals DEFAULT_CONFIG', () => {
    const j = JSON.parse(readFileSync(resolve(__dirname, '../content/hooks/default-config.json'), 'utf8'));
    noEffort(j);
    expect(j).toEqual(DEFAULT_CONFIG);
  });
  it('AC8: readConfig with no profile yields balanced for claude, junie and cross-agent reviewer', () => {
    for (const c of [readConfig(cfg({})), readConfig('/nonexistent/config.json')] as any[]) {
      expect(c.models.claude.effort).toEqual(MATRIX.balanced);
      expect(c.models.junie.effort).toEqual(MATRIX.balanced);
      expect(c.models.codex.effort).toEqual(MATRIX.balanced);
      expect(c.models.crossAgentReviewer.effort).toEqual({ claude: 'high' });
    }
  });
  it('AC8: a config effort equal to a default value does not change the profile result', () => {
    const c = readConfig(
      cfg({
        models: {
          claude: { effort: { scout: 'medium', reviewer: 'high' } },
          junie: { effort: { tester: 'medium' } },
          codex: { effort: { tester: 'medium' } },
          crossAgentReviewer: { effort: { claude: 'high' } },
        },
      }),
      'deep',
    ) as any;
    expect(c.models.claude.effort).toEqual(MATRIX.deep);
    expect(c.models.junie.effort).toEqual(MATRIX.deep);
    expect(c.models.codex.effort).toEqual(MATRIX.deep);
    expect(c.models.crossAgentReviewer.effort.claude).toBe('xhigh');
  });
});
