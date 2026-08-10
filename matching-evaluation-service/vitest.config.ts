import { defineConfig } from 'vitest/config';

// Mirrors every other Tier 0 service's vitest.config.ts.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 20000, // LTR training round-trips can take longer than vitest's 5s default
  },
});
