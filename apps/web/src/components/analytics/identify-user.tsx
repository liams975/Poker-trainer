'use client';

import { useEffect } from 'react';

import { identify } from '@/lib/analytics/client';

/**
 * Links the anonymous session to an account.
 *
 * Rendered from the signed-in layout rather than from the sign-in form, because
 * both ways in — email and Google — end in a server-side redirect, and a form
 * that redirects has no success callback to hang this on. The layout is the one
 * place that is guaranteed to run for a signed-in user however they arrived.
 *
 * `person_profiles: 'identified_only'` means this call is what creates a
 * PostHog profile at all. Before it there is an anonymous, cookieless session
 * and nothing that persists — which is what `/privacy` says, and what lets the
 * app run without a consent banner.
 */
export function IdentifyUser({ userId }: { userId: string }) {
  useEffect(() => {
    identify(userId);
  }, [userId]);

  return null;
}
