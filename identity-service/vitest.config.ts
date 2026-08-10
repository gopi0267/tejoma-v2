import { defineConfig } from 'vitest/config';

// Mirrors the root project's vitest.config.ts convention (globals enabled, node environment) -
// see /vitest.config.ts.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
