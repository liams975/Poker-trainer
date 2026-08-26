import { NextResponse, type NextRequest } from 'next/server';

import { safeNext } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';

/**
 * OAuth return leg. Google sends the browser here with a one-time `code`,
 * which is exchanged for a session.
 *
 * A Route Handler rather than a page because the exchange writes auth cookies,
 * and Next forbids setting cookies during a Server Component render.
 *
 * NOT EXERCISED LOCALLY: `supabase/config.toml` enables Google but there are no
 * client credentials on a dev machine, so every attempt fails at Google's end
 * before reaching this handler. Verified by inspection only. The one part that
 * is genuinely easy to get wrong — the redirect target — is `safeNext()`, which
 * is unit-tested against the usual bypasses.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  // Google reports user-facing failures (consent declined, for one) as params
  // rather than by omitting the code. Surface it instead of showing a generic
  // failure that says nothing.
  const oauthError = searchParams.get('error_description') ?? searchParams.get('error');
  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent(oauthError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent('That sign-in link was incomplete. Try again.')}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent(error.message)}`);
  }

  // `origin` comes from the request Next parsed, not from a user-supplied
  // parameter, and `next` has been through safeNext(). Neither half is
  // attacker-controlled.
  return NextResponse.redirect(`${origin}${next}`);
}
