import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@engine': resolve('src/renderer/src/engine'),
      '@ui': resolve('src/renderer/src/ui'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/main/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
