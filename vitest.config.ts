import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // src/algorithms/*.test.ts predates this config and uses Jest-style describe/test/expect
    // globals rather than explicit vitest imports - enabling globals lets both styles coexist
    // instead of rewriting already-correct, already-passing test files.
    globals: true,
    environment: 'node',
  },
});
