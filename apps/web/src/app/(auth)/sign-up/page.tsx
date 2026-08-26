import Link from 'next/link';

import { AuthForm } from '@/components/auth/auth-form';
import { GoogleButton } from '@/components/auth/google-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { signUp } from '@/lib/auth/actions';
import { safeNext } from '@/lib/auth/redirect';

export const metadata = { title: 'Create an account · Poker Trainer' };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>6-max cash fundamentals, drilled properly.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <AuthForm action={signUp} mode="sign-up" next={next} serverError={params.error} />

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-xs uppercase tracking-wider text-ink-muted">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <GoogleButton next={next} />

        <p className="text-sm text-ink-muted">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-ink underline underline-offset-4">
            Sign in
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
