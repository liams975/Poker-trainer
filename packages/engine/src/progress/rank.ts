/**
 * Rank tiers, from EV lost per spot.
 *
 * The ladder and its thresholds come from the v2 design deck, which states the
 * rule the numbers exist to serve: *"Ranks come from EV lost per spot across
 * your last 200 answers — not from time served. They move down as well as up."*
 *
 * That sentence is the whole design. A rank that only ratcheted upward would
 * measure attendance, and this product already has a streak for that. Ranking
 * on a trailing window of recent play means the number answers "how well am I
 * playing now", which is the only question worth putting on a dashboard.
 *
 * EV loss is used rather than accuracy for the reason docs/03 gives: two of the
 * four grade tiers are correct answers to a mixed spot, so an accuracy
 * percentage is not a measure of skill here. Chips are.
 */

/** One graded answer, reduced to what ranking needs. */
export interface RankedAttempt {
  /** Bigblinds of EV given up on this spot. Never negative. */
  evLoss: number;
}

export interface RankTier {
  name: string;
  /**
   * The average EV loss per spot at or below which this tier is reached.
   * `undefined` on the floor tier, which has no entry requirement.
   */
  threshold?: number;
}

/**
 * Hardest last. `Limper` is where everyone starts and has no threshold; each
 * subsequent tier is reached by getting the trailing average *down* to its
 * number, so the thresholds descend.
 */
export const RANK_TIERS: readonly RankTier[] = [
  { name: 'Limper' },
  { name: 'Reg', threshold: 0.55 },
  { name: 'Grinder', threshold: 0.42 },
  { name: 'Crusher', threshold: 0.3 },
  { name: 'Nemesis', threshold: 0.2 },
];

/**
 * How many graded answers before a rank exists at all.
 *
 * The deck: *"200-spot minimum, so a four-hand hot streak cannot top it."* This
 * is the same conservatism `WEAK_SPOT_MIN_ATTEMPTS` applies in `stats.ts`, at
 * the scale a public board needs rather than a private nudge.
 */
export const RANK_MIN_SPOTS = 200;

/** Divisions inside a tier, climbing I -> II -> III toward the next tier. */
export const RANK_DIVISIONS = 3;

export interface NextRank {
  tier: string;
  /** The EV loss per spot that reaches it. */
  evLossPerSpot: number;
  /** How much further the average has to fall. Never negative. */
  gap: number;
}

export interface PlayerRank {
  tier: string;
  /**
   * 1, 2 or 3, climbing toward the next tier — so `Reg III` is promoted to
   * `Grinder I`, not to `Reg II`. `undefined` on the floor tier, whose band is
   * unbounded above and therefore cannot be divided into thirds.
   */
  division?: number | undefined;
  evLossPerSpot: number;
  /** `undefined` at the top of the ladder. */
  next?: NextRank | undefined;
}

/**
 * Matches `drill_attempts.ev_loss numeric(8,4)`, the same convention
 * `rollUpSkillStats` uses.
 *
 * Not cosmetic. Two hundred attempts of exactly 0.42 sum to 84.00000000000006,
 * so an unrounded mean sits a whisker *above* the Grinder threshold and denies
 * the tier to someone who has precisely met it. The stored data has four
 * decimal places; anything past them is accumulation error, not signal.
 */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Mean EV loss across the given attempts. Zero, not NaN, when there are none. */
export function evLossPerSpot(attempts: readonly RankedAttempt[]): number {
  if (attempts.length === 0) return 0;

  let total = 0;
  for (const attempt of attempts) total += attempt.evLoss;
  return round4(total / attempts.length);
}

/**
 * Which division of `tier` an average sits in.
 *
 * Even thirds of the tier's band. **This is derived, not specified** — the deck
 * shows `REG III` and `Grinder I` without ever stating where the boundaries
 * fall, so docs/05-ui-ux.md records the choice. What the deck *does* fix is the
 * direction: 2f reads "Grinder I — up from Reg III", so III is the top of a
 * tier and I is its entry.
 *
 * The floor tier has no upper bound and the top tier's band runs to zero.
 */
function divisionWithin(index: number, average: number): number | undefined {
  const tier = RANK_TIERS[index];
  if (tier?.threshold === undefined) return undefined;

  // The band runs from this tier's threshold down to the next one, or to a
  // perfect zero for the tier at the top of the ladder.
  const nextThreshold = RANK_TIERS[index + 1]?.threshold ?? 0;
  const band = tier.threshold - nextThreshold;
  if (band <= 0) return RANK_DIVISIONS;

  const progress = (tier.threshold - average) / band;
  const division = Math.floor(progress * RANK_DIVISIONS) + 1;

  return Math.min(Math.max(division, 1), RANK_DIVISIONS);
}

/**
 * The rank earned by the most recent `RANK_MIN_SPOTS` graded answers.
 *
 * Attempts are read **oldest-first**, matching `rollUpSkillStats`, and the
 * window is taken from the end. Passing them newest-first would rank someone on
 * their first two hundred answers forever.
 *
 * Returns `undefined` below the minimum sample rather than a provisional rank:
 * a tier shown and then withdrawn reads as a bug, and "not yet ranked" is a
 * true and useful thing to render.
 */
export function rankFor(attempts: readonly RankedAttempt[]): PlayerRank | undefined {
  if (attempts.length < RANK_MIN_SPOTS) return undefined;

  const recent = attempts.slice(-RANK_MIN_SPOTS);
  const average = evLossPerSpot(recent);

  // Walk down from the hardest tier; the first whose threshold the average has
  // reached is the one earned. The floor tier has no threshold and always matches.
  let index = 0;
  for (let i = RANK_TIERS.length - 1; i >= 0; i -= 1) {
    const threshold = RANK_TIERS[i]?.threshold;
    if (threshold === undefined || average <= threshold) {
      index = i;
      break;
    }
  }

  const tier = RANK_TIERS[index]!;
  const above = RANK_TIERS[index + 1];

  return {
    tier: tier.name,
    division: divisionWithin(index, average),
    evLossPerSpot: average,
    next:
      above?.threshold === undefined
        ? undefined
        : {
            tier: above.name,
            evLossPerSpot: above.threshold,
            gap: Math.max(average - above.threshold, 0),
          },
  };
}
