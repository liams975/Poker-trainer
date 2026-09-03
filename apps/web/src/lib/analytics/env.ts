/**
 * The public analytics values, read in one place.
 *
 * Exactly the pattern `lib/supabase/env.ts` establishes, and for the same
 * reason: `process.env` is banned across `apps/web` so that
 * `SUPABASE_SERVICE_ROLE_KEY` cannot be reached from anything that ships to a
 * browser. Isolating each read into a named file is the mechanism that makes
 * that ban enforceable rather than aspirational, so a second reader gets a
 * second file rather than an exception at the call site.
 *
 * Read as `process.env.NEXT_PUBLIC_X` literally, never `process.env[name]` —
 * Next inlines these at build time by matching the literal text, and a computed
 * lookup silently yields undefined in the browser.
 *
 * Unlike the Supabase values these do not throw when absent. The app works
 * perfectly well without analytics, and it must: they are unset in development
 * and in CI, and a test run should not be filling the production funnel.
 */

export interface AnalyticsEnv {
  key: string;
  host: string;
}

/** Null when PostHog is not configured, which is the normal local state. */
export function posthogEnv(): AnalyticsEnv | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  if (!key || !host) return null;

  return { key, host };
}
