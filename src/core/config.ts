import { existsSync, readFileSync } from 'node:fs';

export type Role = 'scout' | 'tester' | 'implementer' | 'reviewer';

export interface LoopwrightConfig {
  maxFixRounds: number;
  crossModelReview: 'off' | 'codex' | 'claude';
  docsDir: string;
  models: {
    claude: Record<Role, string>;
    codex: Record<Role, string> & { effort?: Partial<Record<Role, string>> };
    junie: Record<Role, string> & { effort?: Partial<Record<Role, string>> };
    crossModelReviewer: { claude: string; codex: string };
  };
}

export const DEFAULT_CONFIG: LoopwrightConfig = {
  maxFixRounds: 3,
  crossModelReview: 'off',
  docsDir: 'docs/agents',
  models: {
    claude: { scout: 'opus', tester: 'sonnet', implementer: 'sonnet', reviewer: 'opus' },
    codex: { scout: 'inherit', tester: 'inherit', implementer: 'inherit', reviewer: 'inherit' },
    junie: {
      scout: 'opus',
      tester: 'sonnet',
      implementer: 'sonnet',
      reviewer: 'gpt',
      effort: { scout: 'medium', tester: 'medium', implementer: 'medium', reviewer: 'high' },
    },
    crossModelReviewer: { claude: 'opus', codex: 'inherit' },
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

export function readConfig(path: string): LoopwrightConfig {
  if (!existsSync(path)) return structuredClone(DEFAULT_CONFIG);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Invalid JSON in ${path}: ${(e as Error).message}`);
  }
  return merge(structuredClone(DEFAULT_CONFIG), parsed) as LoopwrightConfig;
}
