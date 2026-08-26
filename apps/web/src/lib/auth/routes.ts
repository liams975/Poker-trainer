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
] as const;

export function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;

  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
