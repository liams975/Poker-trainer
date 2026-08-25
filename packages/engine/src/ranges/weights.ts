/**
 * Range algebra.
 *
 * Combining ranges — "the button's opening range minus the hands it would
 * three-bet", "hands both charts play" — is a set operation, but ranges are
 * not sets. A hand can be half in. So the algebra runs over a derived weight
 * view: each of the 169 hands mapped to [0, 1].
 *
 * These are the standard fuzzy-set operations (union = max, intersect = min),
 * which is what makes them associative, commutative, idempotent and
 * distributive — the laws docs/03-poker-engine.md asks to be tested. Defining
 * union on `Range` itself as a normalised sum of distributions would look
 * tidier and break every one of them.
 *
 * Weights are always total over all 169 hands, so no operation has to decide
 * what a missing hand means.
 */

import type { HandNotation } from '../cards';
import { CANONICAL_HANDS, comboCountOf } from '../cards';

import type { Action } from './action';
import type { Range } from './range';
import { foldFrequency, frequencyOf, handStrategy } from './range';

export type HandWeights = Readonly<Record<HandNotation, number>>;

export const EMPTY_WEIGHTS: HandWeights = Object.freeze(
  Object.fromEntries(CANONICAL_HANDS.map((hand) => [hand, 0])),
);

export function weightOf(weights: HandWeights, hand: HandNotation): number {
  return weights[hand] ?? 0;
}

/**
 * Projects a range onto a single number per hand.
 *
 * With no action, the weight is how often the hand is *played* — 1 − fold
 * frequency — which is what "how wide is this range" means. With an action, it
 * is that action's frequency, summed across sizes, so `toWeights(chart,
 * 'raise')` is the three-betting portion of a defence chart.
 */
export function toWeights(range: Range, action?: Action): HandWeights {
  const weights: Record<HandNotation, number> = {};

  for (const hand of CANONICAL_HANDS) {
    const strategy = handStrategy(range, hand);
    weights[hand] =
      action === undefined ? 1 - foldFrequency(strategy) : frequencyOf(strategy, action);
  }

  return weights;
}

function combine(
  a: HandWeights,
  b: HandWeights,
  op: (x: number, y: number) => number,
): HandWeights {
  const weights: Record<HandNotation, number> = {};
  for (const hand of CANONICAL_HANDS) {
    weights[hand] = op(weightOf(a, hand), weightOf(b, hand));
  }
  return weights;
}

/** Hands in either range, at the higher weight. */
export function unionWeights(a: HandWeights, b: HandWeights): HandWeights {
  return combine(a, b, Math.max);
}

/** Hands in both ranges, at the lower weight. */
export function intersectWeights(a: HandWeights, b: HandWeights): HandWeights {
  return combine(a, b, Math.min);
}

/** `a` with `b` removed, clamped at zero. */
export function subtractWeights(a: HandWeights, b: HandWeights): HandWeights {
  return combine(a, b, (x, y) => Math.max(0, x - y));
}

/** Scales every weight, clamped into [0, 1]. */
export function scaleWeights(weights: HandWeights, factor: number): HandWeights {
  if (!Number.isFinite(factor) || factor < 0) {
    throw new RangeError(`scale factor must be a non-negative number, got ${factor}`);
  }

  const scaled: Record<HandNotation, number> = {};
  for (const hand of CANONICAL_HANDS) {
    scaled[hand] = Math.min(1, weightOf(weights, hand) * factor);
  }
  return scaled;
}

/**
 * How many of the 1326 two-card holdings this range represents, weighted.
 *
 * The per-hand counts (6 pair / 4 suited / 12 offsuit) come from
 * cards/notation, where they are already tested against an exact partition of
 * the deck. Re-deriving them here would be a second source of truth.
 */
export function comboCount(weights: HandWeights): number {
  let total = 0;
  for (const hand of CANONICAL_HANDS) {
    const weight = weightOf(weights, hand);
    if (weight > 0) total += comboCountOf(hand) * weight;
  }
  return total;
}

/** How many of the 169 hands appear at all, regardless of weight. */
export function handCount(weights: HandWeights): number {
  let total = 0;
  for (const hand of CANONICAL_HANDS) {
    if (weightOf(weights, hand) > 0) total += 1;
  }
  return total;
}
