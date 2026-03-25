import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/server/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts'],
      exclude: ['src/server/**/*.test.ts', 'src/server/types/**'],
    },
  },
});
