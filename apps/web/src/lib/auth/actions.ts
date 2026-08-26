'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { safeNext } from './redirect';

export interface AuthFormState {
  error: string | null;
}

/** Server Actions receive strings or Files; narrow before trusting anything. */
function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Copy follows docs/05: errors say what happened and what to do, and they do
 * not apologise. Supabase's raw messages are reasonable but inconsistent in
 * tone, so the few a user will actually hit are rewritten.
 */
function humanise(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return 'That email and password do not match an account. Check both, or create an account.';
  }
  if (/already registered/i.test(message)) {
    return 'That email already has an account. Sign in instead.';
  }
  if (/password should be at least/i.test(message)) {
    return 'Passwords need at least 8 characters.';
  }
  return message;
}

export async function signIn(_prev: AuthFormState, data: FormData): Promise<AuthFormState> {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: field(data, 'email'),
    password: field(data, 'password'),
  });

  if (error) return { error: humanise(error.message) };

  // The layout above this route renders the signed-in shell, so it has to be
  // rebuilt before the redirect or the user briefly sees the signed-out one.
  revalidatePath('/', 'layout');
  redirect(safeNext(field(data, 'next')));
}

export async function signUp(_prev: AuthFormState, data: FormData): Promise<AuthFormState> {
  const supabase = await createClient();

  const email = field(data, 'email');

  /**
   * `timezone` and `display_name` are a contract with Phase 4.
   * `handle_new_user()` reads exactly these two keys out of
   * `raw_user_meta_data` to populate `profiles`, and docs/04 calls timezone
   * load-bearing for streak logic while warning against silently defaulting to
   * UTC. The trigger validates the zone against `pg_timezone_names` and falls
   * back to UTC rather than failing signup, and truncates the display name to
   * 50 rather than rejecting it — so a hostile or absent value here costs
   * accuracy, never an account.
   */
  const timezone = field(data, 'timezone');

  const { data: result, error } = await supabase.auth.signUp({
    email,
    password: field(data, 'password'),
    options: {
      data: {
        timezone,
        display_name: field(data, 'display_name') || email.split('@')[0],
      },
    },
  });

  if (error) return { error: humanise(error.message) };

  /**
   * Whether a session comes back depends on the environment, and both are
   * correct. Locally `enable_confirmations` is off so the RLS suite can sign
   * users up and get a session immediately; production keeps confirmations on,
   * where signUp returns a user with no session until they click the link.
   *
   * Redirecting unconditionally would, in production, send them to a protected
   * route with no session — straight back to sign-in with no explanation.
   */
  if (!result.session) {
    redirect(`/sign-up/check-email?email=${encodeURIComponent(email)}`);
  }

  revalidatePath('/', 'layout');
  redirect(safeNext(field(data, 'next')));
}

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath('/', 'layout');
  redirect('/sign-in');
}
