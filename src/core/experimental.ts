export const EXPERIMENTAL_FEATURES = ['junie-hooks'] as const;

export type ExperimentalFeature = (typeof EXPERIMENTAL_FEATURES)[number];

/** Parse a comma-separated `--experimental` value; `all` expands to every feature, in registry order. */
export function parseExperimental(raw: string): ExperimentalFeature[] {
  const names = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const out = new Set<ExperimentalFeature>();
  for (const n of names) {
    if (n === 'all') {
      for (const f of EXPERIMENTAL_FEATURES) out.add(f);
    } else if ((EXPERIMENTAL_FEATURES as readonly string[]).includes(n)) {
      out.add(n as ExperimentalFeature);
    } else {
      throw new Error(`Unknown experimental feature "${n}". Valid: ${EXPERIMENTAL_FEATURES.join(', ')}, all`);
    }
  }
  return EXPERIMENTAL_FEATURES.filter((f) => out.has(f));
}
