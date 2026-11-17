import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';
import { DEFAULT_CONFIG } from '../src/core/config.js';

describe('simplify config key', () => {
  it('defaults to true in the built-in config', () => {
    expect(DEFAULT_CONFIG).toMatchObject({ simplify: true });
  });

  it('defaults to true in the default config the hooks scaffold from', () => {
    const file = JSON.parse(readFileSync(join(contentRoot(), 'hooks/default-config.json'), 'utf8'));
    expect(file).toMatchObject({ simplify: true });
  });
});
