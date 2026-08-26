'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

/**
 * Google sign-in.
 *
 * Client-side rather than a Server Action because `signInWithOAuth` needs to
 * navigate the top-level browser window to Google's consent screen.
 *
 * NOT EXERCISED LOCALLY: config.toml enables the provider but a dev machine
 * has no client credentials, so this fails at Google. The return leg is
 * src/app/auth/callback/route.ts.
 */
export function GoogleButton({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signInWithGoogle() {
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Absolute, because Google redirects back from its own origin.
        // `window.location.origin` rather than an env var so this works
        // unchanged across localhost, previews and production.
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
    // On success the browser has already navigated away, so there is no
    // success branch to write.
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => void signInWithGoogle()}
        disabled={pending}
      >
        {pending ? 'Redirecting…' : 'Continue with Google'}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-action-raise">
          {error}
        </p>
      ) : null}
    </div>
  );
}
