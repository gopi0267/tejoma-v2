import { defineConfig } from 'vitest/config';

// Mirrors identity-service/vitest.config.ts and the root project's vitest.config.ts convention
// (globals enabled, node environment).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
