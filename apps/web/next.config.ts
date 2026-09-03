import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// From `/config`, not the package root: the root re-export is deprecated in
// v10 and stops working in v11, and it warns on every single build until then.
import { withSentryConfig } from '@sentry/nextjs/config';
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

/**
 * Sentry wraps the config rather than being configured inside it, because the
 * source-map upload is a build step, not a runtime setting.
 *
 * With no `SENTRY_AUTH_TOKEN` — every local build, and CI — the plugin skips
 * the upload and the build is otherwise unchanged. So this is not something
 * that has to be conditionally applied; it is inert without credentials.
 *
 * Without the upload, Sentry still receives every error. The stack traces just
 * point into minified output, which makes them close to useless — which is why
 * `@sentry/cli` is the one package besides esbuild allowed to run an install
 * script in pnpm-workspace.yaml.
 */
export default withSentryConfig(nextConfig, {
  // Spread rather than assigned, because `exactOptionalPropertyTypes` draws a
  // distinction the plugin's own types rely on: an absent key means "work it
  // out", an explicit `undefined` does not type-check.
  ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT ? { project: process.env.SENTRY_PROJECT } : {}),
  ...(process.env.SENTRY_AUTH_TOKEN ? { authToken: process.env.SENTRY_AUTH_TOKEN } : {}),

  // The plugin is chatty on every build otherwise, and a build log nobody
  // reads is a build log that hides the warning that mattered.
  silent: !process.env.CI,

  // Uploads maps for the workspace packages too. The engine is where the
  // correctness-critical code lives, so a trace that stops at its boundary
  // would stop exactly where it gets interesting.
  widenClientFileUpload: true,

  // Strips the maps from the deployed bundle after upload: Sentry can resolve
  // a trace, a visitor's devtools cannot read the source.
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Routes browser reports through the app's own origin, so an ad blocker
  // stopping requests to sentry.io does not silently stop error reporting.
  tunnelRoute: '/monitoring',

  // `disableLogger: true` is the older spelling of this and is deprecated.
  // Strips Sentry's own debug logging from the production bundle.
  webpack: { treeshake: { removeDebugLogging: true } },
});
