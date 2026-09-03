import Link from 'next/link';

import { TrackEvent } from '@/components/analytics/track-event';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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

      <Card>
        <CardHeader>
          <CardTitle>Confirm your email</CardTitle>
          <CardDescription>
            {email
              ? `We sent a link to ${email}. Open it and you are in.`
              : 'We sent you a link. Open it and you are in.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-ink-muted">
          <p>The link expires in an hour. If it does, sign in and we will send another.</p>
          <p>
            <Link href="/sign-in" className="text-ink underline underline-offset-4">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </>
  );
}
