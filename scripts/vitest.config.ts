import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Database integration tests, deliberately in their own config.
 *
 * This file lives inside @poker/scripts rather than at the repo root so that
 * the package's own tsconfig typechecks it along with the tests it configures.
 * A test file outside every tsconfig is a test file nobody is checking, which
 * is how a whole suite rots without a single red build — and a config that
 * says so while sitting outside one itself is worse than no comment.
 *
 * `pnpm test` must stay hermetic and offline: it runs on every save and in the
 * main CI job, and it cannot depend on Docker being up. These tests need a
 * live Supabase stack with content already synced, so they run separately via
 * `pnpm test:db` and in their own CI job.
 *
 * Single-threaded and serial: every test in the file shares two signed-up
 * users and one seeded row, and parallel workers would race on them.
 */

/**
 * Loads the repo root .env.local if it is there, so `pnpm test:db` works
 * straight after `supabase start` without exporting anything by hand.
 * Hand-rolled rather than pulling in dotenv for six lines. Real environment
 * variables win, which is what lets CI supply the values without a file.
 */
function localEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  try {
    const raw = readFileSync(resolve(import.meta.dirname, '..', '.env.local'), 'utf8');

    for (const line of raw.split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match && process.env[match[1]!] === undefined) {
        env[match[1]!] = match[2]!.trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // No .env.local. Fine — CI exports the values directly.
  }

  return env;
}

export default defineConfig({
  test: {
    name: 'db',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: localEnv(),
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
