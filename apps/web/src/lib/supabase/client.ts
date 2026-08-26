import { createBrowserClient } from '@supabase/ssr';

import { supabaseAnonKey, supabaseUrl } from './env';

/**
 * The browser client.
 *
 * Holds the anon key, which is public by design and safe *only* because RLS is
 * correct — docs/01-architecture.md ranks RLS gaps as the #1 attack surface for
 * this app, and Phase 4's policy suite is what makes shipping this key sane.
 *
 * Writes the session to cookies rather than localStorage so a Server Component
 * can read it. That is the entire reason @supabase/ssr exists.
 */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
