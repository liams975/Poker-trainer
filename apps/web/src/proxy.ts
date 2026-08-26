import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { isPublicPath } from '@/lib/auth/routes';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/env';

/**
 * `proxy.ts`, NOT `middleware.ts`.
 *
 * The `middleware` file convention is deprecated in Next 16 and renamed to
 * `proxy` — same behaviour, different file and export name. Every Supabase
 * SSR guide in existence still says `middleware.ts`, and a file by that name
 * here would simply never run: no session refresh, and a silent logout on
 * every navigation once the first access token expires. Proxy also defaults to
 * the Node.js runtime now, and setting the `runtime` config option throws.
 *
 * Two jobs, and only two:
 *
 *   1. Refresh the session and write the rotated cookies onto the response.
 *      This is the reason the try/catch in lib/supabase/server.ts is safe to
 *      swallow — by the time a Server Component renders, the refresh already
 *      happened here.
 *   2. Bounce signed-out visitors away from protected routes, for UX.
 *
 * What it is emphatically NOT is the security boundary. Next's own auth guide:
 * "it should not be your only line of defense in protecting your data." It
 * runs on prefetches, it is the layer with a public CVE history for header-
 * based bypass, and it is assumed defeatable here. The real checks are
 * `requireUser()` in every protected layout and Postgres RLS beneath that.
 */
export async function proxy(request: NextRequest) {
  // Must carry the incoming request through, so that cookies set below land on
  // the response the browser actually receives.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  /**
   * Triggers the refresh. `getClaims()` verifies the token rather than merely
   * decoding it, which `getSession()` would do.
   *
   * Deliberately the only Supabase call here: the Next docs warn that proxy
   * runs on every route including prefetched ones, so this is not the place
   * for a database round-trip. The authoritative user lookup happens once per
   * render in lib/auth/dal.ts instead.
   */
  const { data } = await supabase.auth.getClaims();

  const { pathname } = request.nextUrl;

  if (!data?.claims && !isPublicPath(pathname)) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/sign-in';
    signIn.search = '';
    // Where they were going, so sign-in can put them back. safeNext() on the
    // reading end rejects anything that is not same-origin — this value is
    // built from our own URL, but the parameter is user-editable once it is in
    // the address bar.
    signIn.searchParams.set('next', `${pathname}${request.nextUrl.search}`);

    return NextResponse.redirect(signIn);
  }

  return response;
}

export const config = {
  /**
   * Everything except static assets and image files. Running on `_next/static`
   * would burn a token refresh on every chunk request.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
