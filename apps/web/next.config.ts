import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

/**
 * Load the repo-root .env.local.
 *
 * Next only looks for .env files in the app directory, but this is a monorepo
 * and the root .env.local is already the single source for `pnpm content:sync`
 * and `pnpm test:db` — .env.example documents it there. Without this the app
 * builds fine and then fails at runtime with "NEXT_PUBLIC_SUPABASE_URL is not
 * set", because the NEXT_PUBLIC_ values were never present to be inlined.
 *
 * Real environment variables win, so Vercel and CI supply values normally and
 * this is a no-op there. Fifteen lines rather than a dotenv dependency, and
 * deliberately not shared with scripts/vitest.config.ts: that one runs in a
 * different package with a different root, and coupling two build configs
 * through a helper import is worse than two small readers.
 */
function loadRootEnv(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  let raw: string;
  try {
    raw = readFileSync(resolve(root, '.env.local'), 'utf8');
  } catch {
    return; // Not present. Fine — the platform supplies the values.
  }

  for (const line of raw.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2]?.trim().replace(/^["']|["']$/g, '') ?? '';
    }
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  // The workspace packages ship raw TypeScript rather than a build artifact,
  // so Next compiles them alongside the app. This is also what keeps the
  // engine consumable unchanged by a React Native bundler in v2.
  transpilePackages: ['@poker/engine', '@poker/content'],
};

export default nextConfig;
