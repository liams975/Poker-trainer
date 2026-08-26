import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { supabaseAnonKey, supabaseUrl } from './env';

/**
 * The server client, for Server Components, Server Actions and Route Handlers.
 *
 * `cookies()` is async in Next 16, hence the await.
 *
 * IMPORTANT: never call `auth.getSession()` on this client. It decodes the
 * cookie without verifying the signature, so a forged cookie yields a
 * "session" and any check built on it is an authentication bypass. Use
 * `getCurrentUser()` from lib/auth/dal.ts, which goes through `getUser()` and
 * revalidates against the auth server. eslint.config.mjs bans the call outright
 * so this comment cannot rot into a suggestion.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          /**
           * Next forbids setting cookies during a Server Component render —
           * headers are already committed by then. This is expected and safe
           * to swallow *because* src/proxy.ts refreshes the session on every
           * navigation, so the refreshed cookie has already been written to
           * the response before any component renders.
           *
           * If proxy.ts is ever removed, this becomes a silent logout loop
           * rather than an error. That coupling is why the matcher in
           * proxy.ts has its own test.
           */
        }
      },
    },
  });
}
