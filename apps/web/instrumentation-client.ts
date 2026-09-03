import * as Sentry from '@sentry/nextjs';

/**
 * Browser-side Sentry.
 *
 * `instrumentation-client.ts` rather than the older `sentry.client.config.ts`:
 * Next 15 moved client instrumentation to this file and the Sentry SDK follows
 * it. Both names would work today; the deprecated one is how a project quietly
 * stops reporting after a major upgrade.
 *
 * No DSN means no reporting, which is the correct state in development and in
 * CI — a test run should not fill the production issue list.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // The app has one user today. Sampling would mean losing the only report of
  // a bug that happened once, and there is no volume to protect against.
  tracesSampleRate: 1,

  // Neither is on. Replays record what a user did, which is a different order
  // of collection from an error report, and `/privacy` does not claim it —
  // turning it on would make that page untrue.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // In development, errors belong in the terminal where they are already
  // legible, not in a remote issue tracker.
  enabled: process.env.NODE_ENV === 'production',

  /**
   * A last filter before anything leaves the browser.
   *
   * Supabase auth errors are routine — an expired token on a laptop reopened
   * after a week is not an incident — and they arrive often enough to bury
   * real reports.
   */
  beforeSend(event, hint) {
    const error = hint.originalException;
    const message = error instanceof Error ? error.message : String(error ?? '');

    if (/refresh token|invalid claim|jwt expired/i.test(message)) return null;

    return event;
  },
});

// Required by Next's App Router for navigation instrumentation to work.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
