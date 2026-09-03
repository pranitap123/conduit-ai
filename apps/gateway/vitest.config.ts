import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Load .env into process.env before tests import env.ts */
function loadEnv(path: string): void {
  try {
    const content = readFileSync(path, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (key) process.env[key.trim()] = rest.join('=').trim();
    }
  } catch {
    // file doesn't exist, that's fine — fall through to the next one
  }
}

loadEnv(resolve('.env'));
loadEnv(resolve('../../.env'));

export default defineConfig({
  test: {
    env: { LOG_LEVEL: 'silent' },
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
