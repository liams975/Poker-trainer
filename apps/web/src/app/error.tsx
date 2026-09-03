'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

/**
 * docs/05 on copy: "Errors say what happened and what to do. They don't
 * apologise."
 *
 * `error.message` is deliberately not rendered. In production Next replaces it
 * with a generic string anyway, and in development showing a raw stack to the
 * user teaches nothing — the digest is what correlates with the server log.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest shown below is Next's correlation id; reporting the error here
    // is what makes it resolve to something an operator can open. Without this
    // the reference on screen would be a number with nothing behind it.
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="font-display text-lg font-semibold">This page did not load.</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        Something broke on our side. Try again — if it keeps happening, the reference below will
        help us find it.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-ink-muted">Reference {error.digest}</p>
      ) : null}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
