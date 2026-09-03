/**
 * Which paths require a session, shared by proxy.ts and its tests.
 *
 * Deliberately a deny-by-default list of *public* prefixes rather than an
 * allow-list of protected ones: a route added in Phase 6 or later is protected
 * the moment it exists, without anyone remembering to register it. Getting
 * that backwards is how a new page ships unauthenticated.
 */
const PUBLIC_PREFIXES = [
  '/sign-in',
  '/sign-up',
  '/auth', // callback + confirm route handlers; they run before a session exists
  '/privacy', // linked from the landing page, so it must render signed-out
  // Sentry's tunnel. Browser error reports POST here so an ad blocker cannot
  // silently stop them, and an error on the landing page has no session — the
  // proxy redirecting that to sign-in would drop exactly the reports from
  // visitors who never got in.
  '/monitoring',
] as const;

export function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;

  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
