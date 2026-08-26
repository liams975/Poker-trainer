import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { safeNext } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';

/**
 * Email confirmation and recovery links land here.
 *
 * Needed for production regardless of Google: `supabase/config.toml` keeps
 * `enable_confirmations` ON in production, and only turns it off locally so
 * the RLS suite can sign users up and get a session back. Without this route,
 * every production signup dead-ends at an unverified account.
 *
 * NOT EXERCISED LOCALLY, for exactly that reason. Verified by inspection.
 */
const ALLOWED_TYPES: readonly EmailOtpType[] = ['signup', 'email_change', 'recovery', 'invite'];

function isAllowedType(value: string | null): value is EmailOtpType {
  return value !== null && (ALLOWED_TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = safeNext(searchParams.get('next'));

  // Narrowed against a fixed list rather than cast: `type` is attacker-supplied
  // and is passed straight to the auth API.
  if (!tokenHash || !isAllowedType(type)) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent('That confirmation link is not valid. Request a new one.')}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    // Expired is the common case and deserves better than the raw message.
    const message = /expired/i.test(error.message)
      ? 'That confirmation link has expired. Sign in to get a new one.'
      : error.message;

    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent(message)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
