import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Spawn-heavy tests take seconds each on Windows runners and flake at the 5s default.
    testTimeout: process.platform === 'win32' ? 20_000 : 5_000,
  },
});
