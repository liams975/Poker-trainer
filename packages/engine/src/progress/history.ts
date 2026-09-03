/**
 * Reading history back.
 *
 * `drill_attempts` has recorded the seed, the chart version, the full frequency
 * distribution and the grade of every answer since Phase 7, and until Phase 10
 * nothing read any of it. These are the two aggregations Session Review needs.
 *
 * They live here rather than in a SQL query for the same reason
 * `rollUpSkillStats` does: a chart and a summary that disagree about what a
 * "day" is, or about whether `acceptable` counts as a pass, is the kind of
 * inconsistency nobody notices and everybody half-believes. One definition,
 * testable without a database.
 *
 * **No clock.** A day arrives already resolved in the reader's own timezone —
 * `apps/web/src/lib/progress/timezone.ts` is the only place that decides what
 * day it is anywhere in this app. See `progress/day.ts` for why.
 */

import type { GradeTier } from '../drills';
import { summariseSession, type SessionSummary } from '../drills';

import type { Day } from './day';
import { addDays, dayDiff, isDay } from './day';

/** One graded answer, reduced to what a history view needs. */
export interface HistoryAttempt {
  /** The calendar day it happened, in the reader's zone. */
  day: Day;
  tier: GradeTier;
  evLoss: number;
  skillTags: readonly string[];
}

export interface DayPoint {
  day: Day;
  attempts: number;
  /** `optimal` or `acceptable` — both are defensible answers to a mixed spot. */
  passes: number;
  /** Null on a day with no attempts: "no data" and "0%" are different claims. */
  accuracy: number | null;
  avgEvLoss: number | null;
}

export interface HistoryWindow {
  from: Day;
  to: Day;
}

/**
 * A year of daily points is 365 small objects and perfectly fine. A decade of
 * them because a date was misparsed somewhere upstream is not, and the failure
 * would look like a slow page rather than a bug.
 */
export const MAX_HISTORY_DAYS = 400;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function isPass(tier: GradeTier): boolean {
  return tier === 'optimal' || tier === 'acceptable';
}

function checkDay(value: unknown, name: string): asserts value is Day {
  if (!isDay(value)) {
    throw new RangeError(`${name} must be a calendar date as YYYY-MM-DD, got ${String(value)}`);
  }
}

interface Bucket {
  attempts: number;
  passes: number;
  evLoss: number;
}

/**
 * Accuracy and EV loss per day across a window, zero-filled.
 *
 * Zero-filling is the point. A day nobody practised is a fact about the
 * history, not a missing record — dropping it draws a chart in which three
 * sessions a month apart look like three consecutive days, which is exactly
 * backwards for a product whose whole gamification loop is about showing up.
 */
export function accuracyOverTime(
  attempts: readonly HistoryAttempt[],
  window: HistoryWindow,
): readonly DayPoint[] {
  checkDay(window.from, 'from');
  checkDay(window.to, 'to');

  const span = dayDiff(window.from, window.to);

  if (span < 0) {
    throw new RangeError(`the window runs backwards: from ${window.from} to ${window.to}`);
  }
  if (span >= MAX_HISTORY_DAYS) {
    throw new RangeError(
      `a window of ${span + 1} days exceeds the ${MAX_HISTORY_DAYS}-day maximum`,
    );
  }

  const buckets = new Map<string, Bucket>();

  for (const attempt of attempts) {
    // Outside the window is not an error — the caller may hand over everything
    // it has and let the window do the narrowing.
    if (!isDay(attempt.day)) continue;
    if (dayDiff(window.from, attempt.day) < 0) continue;
    if (dayDiff(attempt.day, window.to) < 0) continue;

    const bucket = buckets.get(attempt.day) ?? { attempts: 0, passes: 0, evLoss: 0 };
    bucket.attempts += 1;
    bucket.passes += isPass(attempt.tier) ? 1 : 0;
    bucket.evLoss += Math.max(0, attempt.evLoss);
    buckets.set(attempt.day, bucket);
  }

  const points: DayPoint[] = [];

  for (let offset = 0; offset <= span; offset++) {
    const day = addDays(window.from, offset);
    const bucket = buckets.get(day);

    points.push(
      bucket === undefined
        ? { day, attempts: 0, passes: 0, accuracy: null, avgEvLoss: null }
        : {
            day,
            attempts: bucket.attempts,
            passes: bucket.passes,
            accuracy: round4(bucket.passes / bucket.attempts),
            avgEvLoss: round4(bucket.evLoss / bucket.attempts),
          },
    );
  }

  return points;
}

export interface TagBreakdown {
  skillTag: string;
  attempts: number;
  passes: number;
  accuracy: number;
  avgEvLoss: number;
}

export interface SessionDigest extends SessionSummary {
  /** Worst first — the thing to work on belongs at the top. */
  byTag: readonly TagBreakdown[];
}

/**
 * One session, summarised, plus where it went wrong.
 *
 * The tier split comes from `summariseSession` rather than being recomputed,
 * so a session cannot read one way on the summary screen and another way in
 * review. That includes its deliberate refusal to produce a single accuracy
 * percentage: docs/03 says score by EV loss, and two of the four tiers are
 * defensible answers rather than partial credit.
 *
 * The per-tag accuracy below is a different thing and is fine — it is a
 * diagnostic about *which spots* to revisit, not a grade for the session.
 */
export function sessionDigest(attempts: readonly HistoryAttempt[]): SessionDigest {
  const summary = summariseSession(
    attempts.map((attempt) => ({ tier: attempt.tier, evLoss: attempt.evLoss })),
  );

  const byTag = new Map<string, Bucket>();

  for (const attempt of attempts) {
    for (const skillTag of attempt.skillTags) {
      const bucket = byTag.get(skillTag) ?? { attempts: 0, passes: 0, evLoss: 0 };
      bucket.attempts += 1;
      bucket.passes += isPass(attempt.tier) ? 1 : 0;
      bucket.evLoss += Math.max(0, attempt.evLoss);
      byTag.set(skillTag, bucket);
    }
  }

  return {
    ...summary,
    byTag: [...byTag.entries()]
      .map(([skillTag, bucket]) => ({
        skillTag,
        attempts: bucket.attempts,
        passes: bucket.passes,
        accuracy: round4(bucket.passes / bucket.attempts),
        avgEvLoss: round4(bucket.evLoss / bucket.attempts),
      }))
      .sort((a, b) => {
        if (a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
        if (a.avgEvLoss !== b.avgEvLoss) return b.avgEvLoss - a.avgEvLoss;
        return a.skillTag < b.skillTag ? -1 : a.skillTag > b.skillTag ? 1 : 0;
      }),
  };
}
