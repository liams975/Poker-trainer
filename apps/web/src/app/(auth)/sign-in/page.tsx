import Link from 'next/link';

import { AuthForm } from '@/components/auth/auth-form';
import { GoogleButton } from '@/components/auth/google-button';
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
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-5xl">
          Sign <i>in</i>
        </h1>
        <p className="text-base text-ink-muted">Pick up where you left off.</p>
      </div>

      <AuthForm action={signIn} mode="sign-in" next={next} serverError={params.error} />

      <div className="flex items-center gap-4">
        <span className="h-px flex-1 bg-line" />
        <span className="label-caps text-2xs text-ink-muted">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <GoogleButton next={next} />

      <p className="text-sm text-ink-muted">
        No account?{' '}
        <Link
          href="/sign-up"
          className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
        >
          Create one
        </Link>
        .
      </p>
    </div>
  );
}
