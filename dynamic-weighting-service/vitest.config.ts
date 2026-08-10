import { defineConfig } from 'vitest/config';

// Mirrors every other Tier 0 service's vitest.config.ts.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
