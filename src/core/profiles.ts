import type { Role } from './config.js';

export type Profile = Record<Role, string>;

/** Effort per role. Mirrored in content/hooks/lib.mjs (a test pins them equal). Efforts only, never models. */
export const PROFILES: Record<string, Profile> = {
  lean: { scout: 'low', tester: 'low', implementer: 'low', reviewer: 'medium' },
  balanced: { scout: 'medium', tester: 'medium', implementer: 'medium', reviewer: 'high' },
  thorough: { scout: 'high', tester: 'high', implementer: 'high', reviewer: 'xhigh' },
  deep: { scout: 'xhigh', tester: 'xhigh', implementer: 'xhigh', reviewer: 'xhigh' },
};

export const PROFILE_NAMES = Object.keys(PROFILES);

export function resolveProfile(name: string): Profile {
  if (!Object.hasOwn(PROFILES, name)) {
    throw new Error(`Unknown profile ${JSON.stringify(name)} (allowed: ${PROFILE_NAMES.join(', ')})`);
  }
  return PROFILES[name]!;
}
