/**
 * The analytics event vocabulary.
 *
 * Closed, and for the same reason `SKILL_TAGS` and `XP_REASONS` are closed. A
 * mistyped event name does not throw and does not show up as an error — it
 * quietly creates a *second* event that nothing ever fires again, and the
 * funnel it was meant to belong to reads as a total drop-off at that step. You
 * find out weeks later, if at all, and by then the data is gone.
 *
 * Adding an event means editing this file, which is the reviewable act it
 * should be. `analytics.test.ts` pins the list and the funnel.
 */

export const ANALYTICS_EVENTS = [
  // The onboarding funnel, which is what the roadmap's exit criterion names:
  // "watch a real user complete onboarding -> lesson -> drill -> review".
  'onboarding_started',
  'placement_finished',
  'lesson_completed',
  'session_finished',
  'review_opened',

  // Everything else, for questions the funnel does not answer.
  // Fired on the check-your-email screen, which is the only point in the
  // sign-up flow with a page of its own. `signed_in` has no equivalent — both
  // ways in end in a server-side redirect with no success callback — so it is
  // deliberately absent rather than declared and never emitted.
  'signed_up',
  'session_started',
  'weak_spots_opened',
  'palette_opened',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * The ordered funnel. Exported so the PostHog dashboard and this codebase
 * describe the same journey, and so a test can prove every step is a real
 * event rather than a name somebody typed into a web UI.
 */
export const ONBOARDING_FUNNEL: readonly AnalyticsEvent[] = [
  'onboarding_started',
  'placement_finished',
  'lesson_completed',
  'session_finished',
  'review_opened',
];

export function isAnalyticsEvent(value: string): value is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(value);
}
