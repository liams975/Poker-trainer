/**
 * The XP schedule, and what a level means.
 *
 * `xp_events` is an append-only ledger and a total is always `sum(amount)` —
 * CLAUDE.md forbids storing a mutable counter, and the roadmap's exit criterion
 * is that totals reconcile with the ledger. That only means something if the
 * schedule is one table in one place, which is this file: a route handler that
 * decides its own numbers is a schedule nobody can reconcile against.
 *
 * docs/04-data-model.md is explicit that XP is bounded but not
 * server-authoritative, and calls that an accepted risk rather than an
 * oversight — `authenticated` holds `insert` on `xp_events`. Nothing in this
 * app *depends* on the browser for a number, so the hole stays a hole rather
 * than becoming a load path, but it is a hole and docs/04 owns that.
 */

import type { GradeTier } from '../drills';

/**
 * What one answer is worth.
 *
 * Every tier pays. docs/05-ui-ux.md sets the tone as "a coach nodding, not a
 * slot machine", and paying zero for a blunder would frame a drill as a test to
 * pass rather than a rep to do. `acceptable` in particular is a defensible
 * answer to a mixed spot, not a near-miss, so the gap above it is small.
 */
export const XP_PER_TIER: Readonly<Record<GradeTier, number>> = {
  optimal: 10,
  acceptable: 7,
  inaccurate: 3,
  blunder: 1,
};

export const XP_LESSON_COMPLETE = 50;

export const XP_DAILY_GOAL = 25;

/**
 * Paid once per achievement, on the call that first records it.
 *
 * Unlike the other three this one has no uuid to key on — `achievements.id` is
 * text — so the `xp_events_once_per_ref` index cannot cover it. What makes it
 * idempotent instead is `user_achievements`, whose composite primary key means
 * only one call can ever be the one that inserts the row.
 */
export const XP_ACHIEVEMENT = 40;

/**
 * Spots that make a day count.
 *
 * A constant rather than `profiles.daily_goal_spots`, because there is no
 * settings surface in v1 to change it — the same reasoning that keeps the
 * placement thresholds here. Promoting it to a column is a one-line migration
 * whenever Phase 10 adds one.
 */
export const DAILY_GOAL_SPOTS = 20;

/** The `xp_events.reason` vocabulary, matched by a CHECK in migration 0004. */
export const XP_REASONS = ['drill_session', 'lesson_complete', 'daily_goal', 'achievement'] as const;

export type XpReason = (typeof XP_REASONS)[number];

/**
 * Drill modes whose attempts count towards XP and the skill rollup.
 *
 * Study mode shows the chart *before* the answer, so its attempts measure
 * reading rather than recall. Placement is a diagnostic taken before any
 * teaching has happened. Both are recorded — they are real history and
 * `drill_attempts` is append-only — and neither may move a number that claims
 * to describe what the user knows.
 */
export const SCORED_DRILL_MODES = ['quick', 'focused', 'weak_spots', 'lesson'] as const;

export function isScoredMode(mode: string): boolean {
  return (SCORED_DRILL_MODES as readonly string[]).includes(mode);
}

/** What a run of graded answers is worth. */
export function xpForAttempts(tiers: readonly GradeTier[]): number {
  let total = 0;
  for (const tier of tiers) {
    // An unknown tier contributes nothing rather than NaN, which would
    // propagate into the ledger and fail the amount CHECK on write.
    total += XP_PER_TIER[tier] ?? 0;
  }
  return total;
}

export function totalXp(events: readonly { amount: number }[]): number {
  return events.reduce((sum, event) => sum + event.amount, 0);
}

export interface LevelProgress {
  level: number;
  /** XP earned since this level began. */
  into: number;
  /** XP between this level and the next. Always positive. */
  needed: number;
}

/**
 * Cumulative XP at which a level begins.
 *
 * Level 1 starts at 0, and each level costs 100 more than the one before —
 * 100, 200, 300… so the curve stretches without ever becoming a wall. A closed
 * form rather than a table because the table would have to end somewhere.
 */
function floorFor(level: number): number {
  return 50 * level * (level - 1);
}

export function levelFor(total: number): LevelProgress {
  const earned = Math.max(0, total);

  /**
   * Solved rather than looped, then corrected. `floorFor(l) <= earned` inverts
   * to `l <= (1 + sqrt(1 + earned / 12.5)) / 2`, but a float square root lands
   * on the wrong side of an exact boundary often enough to matter — level 2 at
   * exactly 100 XP is a thing a user will see — so the result is walked back
   * onto the true boundary instead of trusted.
   */
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + earned / 12.5)) / 2));

  while (floorFor(level) > earned) level -= 1;
  while (floorFor(level + 1) <= earned) level += 1;

  const base = floorFor(level);

  return { level, into: earned - base, needed: floorFor(level + 1) - base };
}
