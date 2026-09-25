import Link from 'next/link';

import { TrackEvent } from '@/components/analytics/track-event';

export const metadata = { title: 'Confirm your email · Poker Trainer' };

/**
 * Where production signups land. Locally `enable_confirmations` is off so the
 * RLS suite can get a session straight back, which means this page is
 * unreachable on a dev machine — signUp() redirects here only when Supabase
 * returns a user with no session.
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <>
      {/* The only page in the sign-up flow of its own, so the only place a
          completed sign-up can be counted. */}
      <TrackEvent event="signed_up" />

      <div className="flex flex-col gap-6">
        <h1 className="font-display text-5xl">
          Confirm your <i>email</i>
        </h1>
        <p className="text-lg text-ink">
          {email
            ? `We sent a link to ${email}. Open it and you are in.`
            : 'We sent you a link. Open it and you are in.'}
        </p>
        <p className="text-sm text-ink-muted">
          The link expires in an hour. If it does, sign in and we will send another.
        </p>
        <p className="text-sm">
          <Link
            href="/sign-in"
            className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </>
  );
}
