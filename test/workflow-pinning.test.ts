import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, '..', '.github', 'workflows');
const read = (f: string) => readFileSync(join(dir, f), 'utf8');
const usesLines = (f: string) =>
  read(f)
    .split('\n')
    .filter((l) => /^\s*-?\s*uses:/.test(l));
const checkout = (f: string) => usesLines(f).find((l) => /actions\/checkout@/.test(l));

describe('workflow action pinning', () => {
  it('pins every action in every workflow to a commit SHA with a version comment', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.yml'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      for (const l of usesLines(f)) {
        expect(l, `${f}: ${l}`).toMatch(/uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d/);
      }
    }
  });

  it('uses the same checkout pin in the Claude workflows as in ci.yml', () => {
    const ref = (l: string | undefined) => l?.match(/actions\/checkout@[0-9a-f]{40}\s+#\s*\S+/)?.[0];
    const expected = ref(checkout('ci.yml'));
    expect(expected).toBeTruthy();
    expect(ref(checkout('claude.yml'))).toBe(expected);
    expect(ref(checkout('claude-code-review.yml'))).toBe(expected);
  });
});
