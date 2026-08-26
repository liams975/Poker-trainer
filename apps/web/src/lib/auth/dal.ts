import type { User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';

/**
 * The Data Access Layer: the authoritative answer to "who is this request?".
 *
 * Next's own auth guide is explicit that the proxy layer is not enough:
 *
 *   "While Proxy can be useful for initial checks, it should not be your only
 *    line of defense in protecting your data. The majority of security checks
 *    should be performed as close as possible to your data source."
 *
 * So `src/proxy.ts` handles session refresh and the optimistic redirect for UX,
 * and every protected route calls `requireUser()` here for the real check.
 * Postgres RLS (Phase 4) is the third layer and the one that still holds if
 * both of these are defeated.
 *
 * `getUser()`, never `getSession()`: the latter decodes the cookie without
 * verifying it, so it will happily describe a forged cookie as a session.
 */

/**
 * Wrapped in React `cache` so a layout and the page beneath it share one
 * network round-trip per request rather than each paying for their own.
 * The cache is per-request, so it cannot leak one user's identity to another.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  // An expired or absent session is `error` here, not an exception. Treat any
  // failure as "not signed in" rather than trying to distinguish causes —
  // there is no failure mode where the safe answer is to let the request past.
  if (error) return null;

  return data.user;
});

/**
 * Use in any layout or page that must not render for a signed-out visitor.
 * Redirects rather than throwing, preserving where they were headed so sign-in
 * can return them there.
 */
export async function requireUser(nextPath?: string): Promise<User> {
  const user = await getCurrentUser();

  if (!user) {
    const target = nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : '/sign-in';
    redirect(target);
  }

  return user;
}
