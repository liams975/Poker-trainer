import { describe, expect, it } from 'vitest';

import type { StreakState } from '../src/progress';
import { advanceStreak, effectiveStreak, streakStatus } from '../src/progress';

/**
 * The streak rule, which docs/04-data-model.md left open until this phase and
 * which is now **strict**: the last active day must be exactly yesterday, or
 * the count starts over.
 *
 * docs/04 also warns that strict resets are the commonest support complaint in
 * this category of app, and the mitigation is not a grace period — it is
 * `streakStatus`, which lets the UI say "play today to keep your 4-day streak"
 * before it vanishes rather than after.
 *
 * The asymmetry below is the part worth reading twice. A day that has already
 * been counted, or a day that appears to be *earlier* than the last active one
 * because the user flew west, must leave the streak untouched. Only a gap
 * forwards is a gap.
 */

function state(overrides: Partial<StreakState> = {}): StreakState {
  return { current: 0, longest: 0, lastActiveDate: null, ...overrides };
}

describe('advanceStreak', () => {
  it('starts a streak on the first ever day of activity', () => {
    const next = advanceStreak({ state: state(), today: '2026-08-26' });

    expect(next.current).toBe(1);
    expect(next.longest).toBe(1);
    expect(next.lastActiveDate).toBe('2026-08-26');
    expect(next.changed).toBe(true);
  });

  it('increments on consecutive days', () => {
    const next = advanceStreak({
      state: state({ current: 4, longest: 9, lastActiveDate: '2026-08-25' }),
      today: '2026-08-26',
    });

    expect(next.current).toBe(5);
    expect(next.longest).toBe(9);
    expect(next.changed).toBe(true);
    expect(next.reset).toBe(false);
  });

  /**
   * Strict. A single missed day is a break — that is the decision, and the
   * mutation that turns `=== 1` into `>= 1` has to fail here.
   */
  it('resets after a gap of even one day', () => {
    const next = advanceStreak({
      state: state({ current: 30, longest: 30, lastActiveDate: '2026-08-24' }),
      today: '2026-08-26',
    });

    expect(next.current).toBe(1);
    expect(next.reset).toBe(true);
  });

  it('resets to 1 rather than 0, because today was active', () => {
    const next = advanceStreak({
      state: state({ current: 12, longest: 12, lastActiveDate: '2026-01-01' }),
      today: '2026-08-26',
    });

    expect(next.current).toBe(1);
    expect(next.longest).toBe(12);
  });

  it('keeps the longest streak when the current one overtakes it', () => {
    const next = advanceStreak({
      state: state({ current: 9, longest: 9, lastActiveDate: '2026-08-25' }),
      today: '2026-08-26',
    });

    // Both counters move together. `streaks_longest_is_longest` forbids the
    // intermediate state, so they are written in one statement.
    expect(next.current).toBe(10);
    expect(next.longest).toBe(10);
  });

  it('never lowers the longest streak', () => {
    const next = advanceStreak({
      state: state({ current: 2, longest: 40, lastActiveDate: '2026-06-01' }),
      today: '2026-08-26',
    });

    expect(next.longest).toBe(40);
  });

  it('is a no-op on a second session the same day', () => {
    const before = state({ current: 5, longest: 7, lastActiveDate: '2026-08-26' });
    const next = advanceStreak({ state: before, today: '2026-08-26' });

    expect(next.current).toBe(5);
    expect(next.longest).toBe(7);
    expect(next.lastActiveDate).toBe('2026-08-26');
    expect(next.changed).toBe(false);
  });

  it('is idempotent — advancing twice in a day is the same as once', () => {
    const once = advanceStreak({
      state: state({ current: 3, longest: 3, lastActiveDate: '2026-08-25' }),
      today: '2026-08-26',
    });
    const twice = advanceStreak({ state: once, today: '2026-08-26' });

    expect(twice.current).toBe(once.current);
    expect(twice.lastActiveDate).toBe(once.lastActiveDate);
    expect(twice.changed).toBe(false);
  });

  /**
   * A user in Auckland flies to Los Angeles and drills on landing. Their local
   * date has gone *backwards*. Losing a streak for crossing the date line would
   * be indefensible, and so would counting the day twice.
   */
  it('leaves the streak alone when the local date moves backwards', () => {
    const before = state({ current: 6, longest: 6, lastActiveDate: '2026-08-26' });
    const next = advanceStreak({ state: before, today: '2026-08-25' });

    expect(next.current).toBe(6);
    expect(next.lastActiveDate).toBe('2026-08-26');
    expect(next.changed).toBe(false);
  });

  it('resumes normally the day after a westward move', () => {
    const landed = advanceStreak({
      state: state({ current: 6, longest: 6, lastActiveDate: '2026-08-26' }),
      today: '2026-08-25',
    });
    const nextDay = advanceStreak({ state: landed, today: '2026-08-27' });

    expect(nextDay.current).toBe(7);
  });

  /**
   * Eastward is the harder direction: the user skips a calendar date entirely
   * and lands on what is, locally, two days later. Strict means that breaks —
   * they genuinely did not drill on a day that existed for them.
   */
  it('breaks on an eastward move that skips a local day', () => {
    const next = advanceStreak({
      state: state({ current: 6, longest: 6, lastActiveDate: '2026-08-25' }),
      today: '2026-08-27',
    });

    expect(next.current).toBe(1);
    expect(next.reset).toBe(true);
  });

  it('does not mutate the state it is given', () => {
    const before = state({ current: 4, longest: 4, lastActiveDate: '2026-08-25' });
    advanceStreak({ state: before, today: '2026-08-26' });

    expect(before).toEqual({ current: 4, longest: 4, lastActiveDate: '2026-08-25' });
  });

  it('refuses a today that is not a calendar date', () => {
    expect(() => advanceStreak({ state: state(), today: '2026-02-30' })).toThrow(/2026-02-30/);
  });

  it('refuses a stored last-active date that is not a calendar date', () => {
    expect(() =>
      advanceStreak({ state: state({ lastActiveDate: 'never' }), today: '2026-08-26' }),
    ).toThrow(/never/);
  });
});

describe('streakStatus', () => {
  it('reports none before any activity', () => {
    expect(streakStatus(state(), '2026-08-26')).toBe('none');
  });

  it('reports active on a day already counted', () => {
    const now = state({ current: 3, longest: 3, lastActiveDate: '2026-08-26' });
    expect(streakStatus(now, '2026-08-26')).toBe('active');
  });

  /**
   * The warning window, and the entire reason this function exists: yesterday
   * counted, today has not, and the streak is one missed evening from gone.
   */
  it('reports at_risk when yesterday counted and today has not', () => {
    const now = state({ current: 4, longest: 4, lastActiveDate: '2026-08-25' });
    expect(streakStatus(now, '2026-08-26')).toBe('at_risk');
  });

  it('reports broken once the gap is more than a day', () => {
    const now = state({ current: 4, longest: 4, lastActiveDate: '2026-08-24' });
    expect(streakStatus(now, '2026-08-26')).toBe('broken');
  });

  it('treats a backwards local date as active, not broken', () => {
    const now = state({ current: 4, longest: 4, lastActiveDate: '2026-08-26' });
    expect(streakStatus(now, '2026-08-25')).toBe('active');
  });
});

describe('effectiveStreak', () => {
  /**
   * The stored counter is only true as of `last_active_date`. Someone who last
   * drilled a week ago still has `current_streak = 7` in the database, and
   * showing them "7 days" would be a lie the moment they open the dashboard.
   */
  it('is zero once the streak is broken, whatever the stored count says', () => {
    const stale = state({ current: 7, longest: 7, lastActiveDate: '2026-08-01' });
    expect(effectiveStreak(stale, '2026-08-26')).toBe(0);
  });

  it('is the stored count while the streak is still live', () => {
    expect(effectiveStreak(state({ current: 7, lastActiveDate: '2026-08-26' }), '2026-08-26')).toBe(7);
    expect(effectiveStreak(state({ current: 7, lastActiveDate: '2026-08-25' }), '2026-08-26')).toBe(7);
  });

  it('is zero for a user who has never been active', () => {
    expect(effectiveStreak(state(), '2026-08-26')).toBe(0);
  });
});
