import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Run unit tests first, then integration (sequential for integration)
    include: ['tests/**/*.test.ts'],
    // Ensure each test file gets its own module context (no singleton leakage)
    isolate: true,
    // Use threads for unit tests; integration suite opts into pool: 'forks' via inline config
    pool: 'threads',
  },
});
