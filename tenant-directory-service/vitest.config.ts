import { defineConfig } from 'vitest/config';

// Mirrors identity-service/vitest.config.ts and platform-governance-service/vitest.config.ts.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
