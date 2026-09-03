import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_EVENTS,
  ONBOARDING_FUNNEL,
  isAnalyticsEvent,
} from '../src/lib/analytics/events';

/**
 * The vocabulary, pinned.
 *
 * A mistyped event name is the one analytics bug that never announces itself:
 * nothing throws, nothing errors, and the funnel step it belonged to simply
 * reads as a total drop-off. These are cheap and they are the only thing
 * standing between that and a month of misleading data.
 */

describe('the event vocabulary', () => {
  it('has no duplicates', () => {
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
  });

  it('uses one naming convention throughout', () => {
    for (const event of ANALYTICS_EVENTS) {
      // lower_snake_case. PostHog is case-sensitive and will happily keep
      // `lesson_completed` and `Lesson Completed` as separate events forever.
      expect(event, event).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it('recognises its own members and nothing else', () => {
    for (const event of ANALYTICS_EVENTS) {
      expect(isAnalyticsEvent(event), event).toBe(true);
    }

    expect(isAnalyticsEvent('lesson_complete')).toBe(false); // the near-miss
    expect(isAnalyticsEvent('Lesson Completed')).toBe(false);
    expect(isAnalyticsEvent('')).toBe(false);
  });
});

describe('the onboarding funnel', () => {
  /**
   * The roadmap's exit criterion is "watch a real user complete onboarding →
   * lesson → drill → review". A funnel step naming an event nothing fires would
   * make that unwatchable while looking configured.
   */
  it('is made entirely of real events', () => {
    for (const step of ONBOARDING_FUNNEL) {
      expect(ANALYTICS_EVENTS, step).toContain(step);
    }
  });

  it('covers the journey the roadmap names', () => {
    expect(ONBOARDING_FUNNEL).toEqual([
      'onboarding_started',
      'placement_finished',
      'lesson_completed',
      'session_finished',
      'review_opened',
    ]);
  });

  it('has no repeated step', () => {
    expect(new Set(ONBOARDING_FUNNEL).size).toBe(ONBOARDING_FUNNEL.length);
  });
});
