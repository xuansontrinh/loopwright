import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const enforcement = readFileSync(join(__dirname, '..', 'docs/enforcement.md'), 'utf8');

describe('compaction instructions docs', () => {
  it('enforcement doc lists the compaction-instructions hook as Claude Code only', () => {
    const line = enforcement.split('\n').find((l) => /PreCompact/.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/compaction instructions/i);
    expect(line).toMatch(/Claude Code only/i);
  });
});
