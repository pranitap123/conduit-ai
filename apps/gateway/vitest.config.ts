import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests share one Postgres and one Redis. Running files in parallel is fine
    // because every test creates its own org/project/key, but log noise is not.
    env: { LOG_LEVEL: 'silent' },
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
