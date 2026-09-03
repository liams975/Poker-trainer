'use client';

import { useEffect, useRef } from 'react';

import { track } from '@/lib/analytics/client';
import type { AnalyticsEvent } from '@/lib/analytics/events';

/**
 * Fires one event when a page mounts.
 *
 * Exists so a Server Component can record a funnel step without becoming a
 * client component to do it — three of the five steps in the roadmap's funnel
 * are on server-rendered pages, and converting those wholesale would ship the
 * whole page to the browser for one analytics call.
 *
 * The ref guards React's development double-invoke, which would otherwise
 * double-count every step of the funnel in local testing and make the numbers
 * disagree with production for no visible reason.
 */
export function TrackEvent({
  event,
  properties,
}: {
  event: AnalyticsEvent;
  properties?: Record<string, unknown>;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track(event, properties);
  }, [event, properties]);

  return null;
}
