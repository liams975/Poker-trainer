/**
 * The per-skill rollup, and what makes a skill weak.
 *
 * docs/04-data-model.md keeps `skill_stats` denormalised on purpose: weak-spot
 * detection runs on every dashboard load and must not aggregate the whole
 * attempt log to do it. That makes this file the single definition of what
 * those columns mean — and the rollup is *recomputed* from `drill_attempts`
 * rather than incremented, which is CLAUDE.md's rule about deriving totals from
 * event tables and is also what makes it reconcilable.
 *
 * Recomputing rather than incrementing has a second benefit that only became
 * true in Phase 7: attempts are now written concurrently, and an in-application
 * read-modify-write of an exponential average from two requests in flight
 * silently drops one of them. A rollup computed in one pass at the end of a
 * session has no such race.
 */

import type { GradeTier } from '../drills';

/**
 * How fast the average forgets. 0.1 puts the half-life at about seven answers,
 * which is what "recent performance" has to mean for a metric that decides
 * where to send someone next — long enough not to react to one bad spot, short
 * enough that last month's mistakes are not still steering.
 */
export const EWMA_ALPHA = 0.1;

/**
 * Below this many answers on a tag, a low score is noise.
 *
 * The same conservatism placement applies from the other direction, for the
 * same reason: someone told their button opening is their weakest skill on the
 * strength of two answers will go and drill noise, and has no way to know that
 * is what happened.
 */
export const WEAK_SPOT_MIN_ATTEMPTS = 12;

/** At or above this recent accuracy a skill is not a weakness. */
export const WEAK_SPOT_CEILING = 0.8;

/** How many the dashboard rail shows. */
export const WEAK_SPOT_LIMIT = 3;

/** One graded answer, reduced to what the rollup needs. */
export interface StatAttempt {
  skillTag: string;
  tier: GradeTier;
  evLoss: number;
}

export interface SkillStat {
  skillTag: string;
  attempts: number;
  /** `optimal` or `acceptable` — both are defensible answers to a mixed spot. */
  correct: number;
  ewmaAccuracy: number;
  avgEvLoss: number;
}

export interface WeakSpotOptions {
  minAttempts?: number;
  ceiling?: number;
  limit?: number;
}

/** Matches `skill_stats.ewma_accuracy numeric(5,4)` and `avg_ev_loss numeric(8,4)`. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function isPass(tier: GradeTier): boolean {
  return tier === 'optimal' || tier === 'acceptable';
}

interface Accumulator {
  attempts: number;
  correct: number;
  ewma: number;
  evLossTotal: number;
}

/**
 * Rolls a run of attempts up per skill tag.
 *
 * **Order matters.** The caller must pass attempts oldest-first: an exponential
 * average is a statement about sequence, and feeding it newest-first inverts
 * exactly the thing it exists to measure.
 */
export function rollUpSkillStats(attempts: readonly StatAttempt[]): readonly SkillStat[] {
  const byTag = new Map<string, Accumulator>();

  for (const attempt of attempts) {
    const observation = isPass(attempt.tier) ? 1 : 0;
    const existing = byTag.get(attempt.skillTag);

    if (existing === undefined) {
      /**
       * Seeded from the first observation, **not** from zero.
       *
       * Seeding at zero averages a tag's opening answers against an imaginary
       * run of failures, so every newly practised skill reads as a weakness for
       * its first several attempts. Weak-spot detection would then point at
       * whatever was drilled most *recently* rather than most *badly* — and it
       * would look entirely plausible every time it did so.
       */
      byTag.set(attempt.skillTag, {
        attempts: 1,
        correct: observation,
        ewma: observation,
        evLossTotal: Math.max(0, attempt.evLoss),
      });
      continue;
    }

    existing.attempts += 1;
    existing.correct += observation;
    existing.ewma = EWMA_ALPHA * observation + (1 - EWMA_ALPHA) * existing.ewma;
    existing.evLossTotal += Math.max(0, attempt.evLoss);
  }

  return [...byTag.entries()]
    .map(([skillTag, acc]) => ({
      skillTag,
      attempts: acc.attempts,
      correct: acc.correct,
      // Clamped as well as rounded: `skill_stats_ewma_is_a_rate` rejects
      // anything outside 0..1, and float drift over a long run is real.
      ewmaAccuracy: Math.min(1, Math.max(0, round4(acc.ewma))),
      avgEvLoss: round4(acc.evLossTotal / acc.attempts),
    }))
    // Sorted so two rollups of the same data are the same value, which is what
    // lets a test compare them and a sync compare row counts.
    .sort((a, b) => (a.skillTag < b.skillTag ? -1 : a.skillTag > b.skillTag ? 1 : 0));
}

/**
 * The skills worth sending someone back to.
 *
 * Not a ranking of everything: a tag played well is not a weak spot however it
 * places against the others, and the rail saying "your weakest skill" about a
 * skill at 95% would be worse than saying nothing.
 */
export function weakSpots(
  stats: readonly SkillStat[],
  options: WeakSpotOptions = {},
): readonly SkillStat[] {
  const minAttempts = options.minAttempts ?? WEAK_SPOT_MIN_ATTEMPTS;
  const ceiling = options.ceiling ?? WEAK_SPOT_CEILING;
  const limit = options.limit ?? WEAK_SPOT_LIMIT;

  return stats
    .filter((stat) => stat.attempts >= minAttempts && stat.ewmaAccuracy < ceiling)
    .slice()
    .sort((a, b) => {
      if (a.ewmaAccuracy !== b.ewmaAccuracy) return a.ewmaAccuracy - b.ewmaAccuracy;
      // A costlier leak first, then the tag, so the rail does not reshuffle
      // itself between two reloads of identical data.
      if (a.avgEvLoss !== b.avgEvLoss) return b.avgEvLoss - a.avgEvLoss;
      return a.skillTag < b.skillTag ? -1 : a.skillTag > b.skillTag ? 1 : 0;
    })
    .slice(0, limit);
}
