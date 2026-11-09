import { describe, expect, it } from 'vitest';
import { parseExperimental } from '../src/core/experimental.js';

describe('parseExperimental edge cases', () => {
  it('empty string means none', () => {
    expect(parseExperimental('')).toEqual([]);
  });
  it('dedupes, trims and mixes all with names', () => {
    expect(parseExperimental(' junie-hooks , junie-hooks,all')).toEqual(['junie-hooks']);
  });
  it('error names the bad feature and the valid ones', () => {
    expect(() => parseExperimental('junie-hooks,x')).toThrow(/"x".*junie-hooks/);
  });
});
