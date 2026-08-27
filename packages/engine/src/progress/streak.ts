/**
 * The streak rule.
 *
 * docs/04-data-model.md left the grace policy open and required Phase 9 to
 * settle it. It is settled as **strict**: the last active day must be exactly
 * yesterday or the count starts again at one. The alternative without extra
 * state — accepting a one-day gap — lets somebody play every other day and hold
 * a "thirty-day streak" forever, which makes the number a decoration rather
 * than a fact.
 *
 * docs/04 also warns that strict resets are the commonest support complaint in
 * this category of app. The answer is `streakStatus`, not a grace period: tell
 * people the streak is at risk while they can still do something about it.
 *
 * Everything here is date arithmetic on `YYYY-MM-DD`. No clock, no timezone, no
 * milliseconds — see `day.ts` for why that is the whole design.
 */

import type { Day } from './day';
import { dayDiff, isDay } from './day';

export interface StreakState {
  current: number;
  longest: number;
  /** Null for an account that has never recorded any activity. */
  lastActiveDate: Day | null;
}

export interface AdvanceStreakOptions {
  state: StreakState;
  /** Today's calendar date **in the user's timezone**, resolved by the caller. */
  today: Day;
}

export interface StreakAdvance extends StreakState {
  lastActiveDate: Day;
  /** False when today was already counted — the caller can skip the write. */
  changed: boolean;
  /** True when a gap ended the previous streak and this began a new one. */
  reset: boolean;
}

export const STREAK_STATUSES = ['none', 'active', 'at_risk', 'broken'] as const;

export type StreakStatus = (typeof STREAK_STATUSES)[number];

function checkState(state: StreakState): void {
  if (state.lastActiveDate !== null && !isDay(state.lastActiveDate)) {
    throw new RangeError(
      `lastActiveDate must be a calendar date or null, got ${String(state.lastActiveDate)}`,
    );
  }
}

/**
 * Records activity on `today` and returns both counters.
 *
 * Both, always, and in one value: `streaks_longest_is_longest` forbids the
 * intermediate state where `current` has been bumped past `longest`, so the two
 * columns have to be written in a single statement rather than in sequence.
 */
export function advanceStreak({ state, today }: AdvanceStreakOptions): StreakAdvance {
  checkState(state);

  if (!isDay(today)) {
    throw new RangeError(`today must be a calendar date as YYYY-MM-DD, got ${String(today)}`);
  }

  if (state.lastActiveDate === null) {
    return { current: 1, longest: Math.max(state.longest, 1), lastActiveDate: today, changed: true, reset: false };
  }

  const gap = dayDiff(state.lastActiveDate, today);

  /**
   * Nothing to do, in two quite different situations.
   *
   * `gap === 0` is a second session today. `gap < 0` is a local date that has
   * moved *backwards* — a user who flew from Auckland to Los Angeles and
   * drilled on landing. Losing a streak for crossing the date line would be
   * indefensible, and counting the day twice would be wrong in the other
   * direction, so the stored date stands until the calendar catches up to it.
   */
  if (gap <= 0) {
    return { ...state, lastActiveDate: state.lastActiveDate, changed: false, reset: false };
  }

  // Reset to 1, not to 0: today *was* active, so the new streak is a day long.
  const current = gap === 1 ? state.current + 1 : 1;

  return {
    current,
    longest: Math.max(state.longest, current),
    lastActiveDate: today,
    changed: true,
    reset: gap > 1,
  };
}

/**
 * Where the streak stands as of `today`, without recording anything.
 *
 * `at_risk` is the one the UI exists to show: yesterday counted, today has not,
 * and one skipped evening ends it. Saying so beforehand is the entire mitigation
 * for a strict rule.
 */
export function streakStatus(state: StreakState, today: Day): StreakStatus {
  checkState(state);

  if (state.lastActiveDate === null || state.current === 0) return 'none';

  const gap = dayDiff(state.lastActiveDate, today);

  if (gap <= 0) return 'active';
  if (gap === 1) return 'at_risk';
  return 'broken';
}

/**
 * The streak as the user should see it today.
 *
 * `streaks.current_streak` is only true as of `last_active_date`. Somebody who
 * last drilled a week ago still has a 7 sitting in that column, and showing it
 * would be a lie told at the exact moment they came back.
 */
export function effectiveStreak(state: StreakState, today: Day): number {
  return streakStatus(state, today) === 'broken' ? 0 : state.current;
}
