import * as Sentry from '@sentry/nextjs';

/**
 * Server-side Sentry, for Route Handlers and Server Components.
 *
 * This half matters more than the browser half. Every write in this app —
 * grading an attempt, awarding XP, computing a placement — happens on the
 * server, and a failure there is invisible to the user beyond a generic error
 * page. `error.tsx` shows them a digest; this is what makes that digest
 * resolve to something.
 *
 * `register` runs once per runtime, and the runtime is checked because the
 * Node and Edge builds need different SDK entry points.
 */
export async function register(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || process.env.NODE_ENV !== 'production') return;

  const common = {
    dsn,
    tracesSampleRate: 1,
    // The service role key never reaches this app (only the sync script holds
    // it), but request bodies can carry a drill scenario and a session id, and
    // neither belongs in an issue tracker.
    sendDefaultPii: false,
  };

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init(common);
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(common);
  }
}

/**
 * Reports errors thrown while rendering a Server Component.
 *
 * Next added this hook because those failures do not surface through any
 * request handler — without it, the most common kind of server error in an App
 * Router app is the one Sentry never sees.
 */
export const onRequestError = Sentry.captureRequestError;
