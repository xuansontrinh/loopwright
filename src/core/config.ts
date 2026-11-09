import { existsSync, readFileSync } from 'node:fs';

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
      effort: { scout: 'medium', tester: 'medium', implementer: 'medium', reviewer: 'high' },
    },
    codex: { scout: 'inherit', tester: 'inherit', implementer: 'inherit', reviewer: 'inherit' },
    junie: {
      scout: 'opus',
      tester: 'sonnet',
      implementer: 'sonnet',
      reviewer: 'gpt',
      effort: { scout: 'medium', tester: 'medium', implementer: 'medium', reviewer: 'high' },
    },
    crossAgentReviewer: { claude: 'opus', codex: 'inherit', effort: { claude: 'high' } },
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

const CLAUDE_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'];
const JUNIE_EFFORT = ['minimal', ...CLAUDE_EFFORT];

function validateEffort(path: string, key: string, values: unknown, allowed: string[]): void {
  if (!isPlainObject(values)) return;
  for (const [role, v] of Object.entries(values)) {
    if (v === '' || (typeof v === 'string' && allowed.includes(v))) continue;
    throw new Error(`Invalid ${key}.${role} in ${path}: ${JSON.stringify(v)} (allowed: ${allowed.join(', ')}, or "")`);
  }
}

export function readConfig(path: string): LoopwrightConfig {
  if (!existsSync(path)) return structuredClone(DEFAULT_CONFIG);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Invalid JSON in ${path}: ${(e as Error).message}`);
  }
  const config = merge(structuredClone(DEFAULT_CONFIG), parsed) as LoopwrightConfig;
  const m = config.models;
  validateEffort(path, 'models.claude.effort', m.claude?.effort, CLAUDE_EFFORT);
  validateEffort(path, 'models.junie.effort', m.junie?.effort, JUNIE_EFFORT);
  validateEffort(path, 'models.crossAgentReviewer.effort', m.crossAgentReviewer?.effort, CLAUDE_EFFORT);
  return config;
}
