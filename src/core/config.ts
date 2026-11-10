import { existsSync, readFileSync } from 'node:fs';
import { PROFILE_NAMES, resolveProfile } from './profiles.js';

export type Role = 'scout' | 'tester' | 'implementer' | 'reviewer';

export interface LoopwrightConfig {
  maxFixRounds: number;
  crossAgentReview: 'off' | 'codex' | 'claude';
  docsDir: string;
  models: {
    claude: Record<Role, string> & { effort?: Partial<Record<Role, string>> };
    codex: Record<Role, string> & { effort?: Partial<Record<Role, string>> };
    junie: Record<Role, string> & { effort?: Partial<Record<Role, string>> };
    crossAgentReviewer: { claude: string; codex: string; effort?: { claude?: string } };
  };
}

export const DEFAULT_CONFIG: LoopwrightConfig = {
  maxFixRounds: 3,
  crossAgentReview: 'off',
  docsDir: 'docs/agents',
  models: {
    claude: {
      scout: 'opus',
      tester: 'sonnet',
      implementer: 'sonnet',
      reviewer: 'opus',
    },
    codex: { scout: 'inherit', tester: 'inherit', implementer: 'inherit', reviewer: 'inherit' },
    junie: {
      scout: 'opus',
      tester: 'sonnet',
      implementer: 'sonnet',
      reviewer: 'gpt',
    },
    crossAgentReviewer: { claude: 'opus', codex: 'inherit' },
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function merge(base: unknown, over: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

/** Efforts come only from `profile` (--profile, default balanced); effort keys in the file are ignored. Models are never touched. */
export function readConfig(path: string, profile?: string): LoopwrightConfig {
  profile ??= 'balanced';
  if (!PROFILE_NAMES.includes(profile)) {
    throw new Error(`Invalid profile in ${path}: ${JSON.stringify(profile)} (allowed: ${PROFILE_NAMES.join(', ')})`);
  }
  let config: unknown = structuredClone(DEFAULT_CONFIG);
  if (existsSync(path)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      throw new Error(`Invalid JSON in ${path}: ${(e as Error).message}`, { cause: e });
    }
    config = merge(config, parsed);
  }
  const efforts = resolveProfile(profile);
  const m = (config as LoopwrightConfig).models;
  m.claude.effort = { ...efforts };
  m.junie.effort = { ...efforts };
  m.codex.effort = { ...efforts };
  m.crossAgentReviewer.effort = { claude: efforts.reviewer };
  return config as LoopwrightConfig;
}
