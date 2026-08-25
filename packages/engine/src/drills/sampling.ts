/**
 * Which hand to put in front of the user.
 *
 * docs/03-poker-engine.md: "Sample hands non-uniformly. Uniform sampling over
 * 169 hands wastes the user's time on trivial folds (`72o` from UTG) and rarely
 * surfaces the genuinely instructive marginal spots — the hands with mixed
 * frequencies are exactly the ones worth drilling. This one choice does more
 * for learning velocity than any amount of UI polish."
 *
 * With the counterweight from the same paragraph: keep some realistic sampling
 * so the user does not learn a distorted prior about which spots occur.
 *
 * Two components, each normalised to a probability distribution *before* they
 * are mixed. Normalising first is what makes the share dial meaningful —
 * entropy in bits and combo counts out of 1326 are not otherwise comparable.
 */

import type { HandNotation } from '../cards';
import { CANONICAL_HANDS, comboCountOf } from '../cards';
import type { ActionFreq, Range } from '../ranges';
import { handStrategy } from '../ranges';
import type { Rng } from '../rng';

/** Probabilities over hands, summing to 1. */
export type HandDistribution = Readonly<Record<HandNotation, number>>;

/** How much of the draw follows real combo frequencies rather than teaching value. */
export const DEFAULT_UNIFORM_SHARE = 0.3;

export interface SamplingOptions {
  /** 0 = drill only decision boundaries, 1 = draw spots as they really occur. */
  uniformShare?: number;
  /** Restrict the draw to a subset of the 169. */
  include?: readonly HandNotation[];
}

/**
 * Shannon entropy of a hand's action frequencies, in bits.
 *
 * Zero for a pure fold or pure raise, one for a coin flip, and higher for a
 * genuine three-way mix. Preferred over `1 - maxFrequency` precisely because
 * that cannot tell a 60/40 from a 60/20/20, which are different lessons.
 */
export function actionEntropy(frequencies: readonly ActionFreq[]): number {
  let entropy = 0;

  for (const entry of frequencies) {
    if (entry.freq <= 0) continue;
    entropy -= entry.freq * Math.log2(entry.freq);
  }

  return entropy;
}

export function samplingWeights(range: Range, options: SamplingOptions = {}): HandDistribution {
  const uniformShare = options.uniformShare ?? DEFAULT_UNIFORM_SHARE;

  if (!Number.isFinite(uniformShare) || uniformShare < 0 || uniformShare > 1) {
    throw new RangeError(`uniformShare must be a number in [0, 1], got ${uniformShare}`);
  }

  const hands = options.include ?? CANONICAL_HANDS;
  if (hands.length === 0) {
    throw new RangeError('a drill needs at least one hand to sample from');
  }

  // `handStrategy` throws on anything outside the 169, so a typo in a template's
  // hand list fails here rather than silently narrowing the draw.
  const boundary = hands.map((hand) => actionEntropy(handStrategy(range, hand)));
  const realistic = hands.map((hand) => comboCountOf(hand));

  const boundaryTotal = boundary.reduce((total, value) => total + value, 0);
  const realisticTotal = realistic.reduce((total, value) => total + value, 0);

  // A chart where every listed hand is pure has no decision boundaries at all,
  // and the boundary component sums to zero. Without this the whole
  // distribution would be NaN.
  const share = boundaryTotal <= 0 ? 1 : uniformShare;

  const distribution: Record<HandNotation, number> = {};
  hands.forEach((hand, index) => {
    const teaching = boundaryTotal > 0 ? boundary[index]! / boundaryTotal : 0;
    const natural = realistic[index]! / realisticTotal;
    distribution[hand] = (1 - share) * teaching + share * natural;
  });

  return distribution;
}

/** Draws one hand. Deterministic for a given seeded `rng`. */
export function sampleHand(rng: Rng, distribution: HandDistribution): HandNotation {
  const entries = Object.entries(distribution).filter(([, weight]) => weight > 0);

  if (entries.length === 0) {
    throw new RangeError('every hand in the distribution has zero weight');
  }

  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let target = rng.nextFloat() * total;

  for (const [hand, weight] of entries) {
    target -= weight;
    if (target < 0) return hand;
  }

  // Only reachable through float drift at the very top of the range: the scan
  // subtracted every weight without going negative, so the last entry examined
  // is the right answer. Note that is not the last canonical hand — '22'-'99'
  // are integer-like keys, which `Object.entries` hoists to the front. Order is
  // fixed and the draw unbiased either way; it just is not grid order.
  return entries[entries.length - 1]![0];
}
