import Link from 'next/link';

import { AuthForm } from '@/components/auth/auth-form';
import { GoogleButton } from '@/components/auth/google-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { signIn } from '@/lib/auth/actions';
import { safeNext } from '@/lib/auth/redirect';

export const metadata = { title: 'Sign in · Poker Trainer' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // searchParams is a Promise in this version of Next.
  const params = await searchParams;
  const next = safeNext(params.next);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Pick up where you left off.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <AuthForm action={signIn} mode="sign-in" next={next} serverError={params.error} />

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-xs uppercase tracking-wider text-ink-muted">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <GoogleButton next={next} />

        <p className="text-sm text-ink-muted">
          No account?{' '}
          <Link href="/sign-up" className="text-ink underline underline-offset-4">
            Create one
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
