import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILES } from '../src/core/profiles.js';

const docs = readFileSync(join(__dirname, '..', 'docs/configuration.md'), 'utf8');

describe('reviewer effort on the thorough profile', () => {
  it('is high, and only deep keeps xhigh', () => {
    expect(PROFILES.thorough).toEqual({ scout: 'high', tester: 'high', implementer: 'high', reviewer: 'high' });
    expect(PROFILES.deep!.reviewer).toBe('xhigh');
    expect(PROFILES.balanced!.reviewer).toBe('high');
  });

  it('is documented with the corrected rationale', () => {
    expect(docs).toContain('| `thorough` | high / high / high / high |');
    expect(docs).toContain('`thorough` ties at `high`');
    expect(docs).not.toContain('so the reviewer sits one step above the others.');
  });
});
