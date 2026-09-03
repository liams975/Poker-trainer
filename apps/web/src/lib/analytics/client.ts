'use client';

import type { PostHog } from 'posthog-js';

import { posthogEnv } from './env';
import { isAnalyticsEvent, type AnalyticsEvent } from './events';

/**
 * PostHog, loaded late and configured to need no cookie banner.
 *
 * **Imported dynamically, and that is a measurement rather than a preference.**
 * `posthog-js` is 268KB unminified — the single largest chunk in the app — and
 * this module is reached from `providers.tsx`, which wraps the root layout.
 * Built both ways and compared: with a static import that chunk is listed by
 * **25** server route files, meaning every route ships it; with the dynamic
 * import, **zero**, and it is fetched only when `initAnalytics` actually runs
 * with a key configured. That includes the landing page, whose whole job is
 * loading fast for someone who has never heard of this app.
 *
 * Analytics is the least urgent thing on any page. It can arrive after the
 * page does.
 *
 * `persistence: 'memory'` is the other load-bearing setting. PostHog's default
 * writes an identifying cookie on first page view, which in the UK and EU needs
 * consent *before* it is set — meaning a banner, and a banner is the first
 * thing every visitor would meet. In-memory persistence means nothing about a
 * visitor survives the tab, so there is nothing to consent to.
 *
 * The cost is real and worth stating: a returning visitor is a new anonymous id
 * each time, so "unique visitors" over-counts. Funnels within a session — which
 * is what the roadmap's exit criterion actually asks for — are unaffected.
 *
 * `person_profiles: 'identified_only'` keeps it that way: a profile exists only
 * for someone who has signed in, where there is an account and a privacy page
 * that says so.
 */

let client: PostHog | null = null;
let loading = false;

export function initAnalytics(): void {
  const env = posthogEnv();

  // Null in development and in CI, and that is the intended state rather than a
  // misconfiguration — nobody should be filling the production funnel with test
  // runs. Every function below no-ops while `client` stays null.
  if (loading || client !== null || env === null) return;

  loading = true;

  void import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(env.key, {
        api_host: env.host,
        persistence: 'memory',
        person_profiles: 'identified_only',
        capture_pageview: true,
        capture_pageleave: true,
        // The app is behind a login and the pages are not sensitive, but a
        // session recording is a different order of collection from an event
        // count, and `/privacy` does not claim it.
        disable_session_recording: true,
      });

      client = posthog;
    })
    .catch(() => {
      // A blocked or failed analytics load must never surface to the user.
      // Losing an event is the correct outcome; losing the page is not.
      loading = false;
    });
}

/**
 * Records an event.
 *
 * The signature only accepts a name from the vocabulary, so a typo is a compile
 * error rather than a phantom funnel step. The runtime check covers the one
 * caller TypeScript cannot see through.
 *
 * Events fired before the dynamic import resolves are dropped rather than
 * queued. They are page views and funnel steps, not writes — and a queue that
 * replays them later would timestamp them wrongly, which is worse than a gap.
 */
export function track(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
  if (client === null || !isAnalyticsEvent(event)) return;

  client.capture(event, properties);
}

/** Links the anonymous session to an account, after sign-in and never before. */
export function identify(userId: string): void {
  client?.identify(userId);
}

/** Unlinks on sign-out, so a shared machine does not attribute two people to one. */
export function resetAnalytics(): void {
  client?.reset();
}
