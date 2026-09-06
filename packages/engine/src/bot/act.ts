/**
 * Turning a recommendation into one action.
 *
 * docs/01-architecture.md's seam, finally used from the other side: "A drill
 * calls `recommend()` and compares it to the user's answer. A v2 bot calls
 * `recommend()` and samples an action from the distribution."
 *
 * **Filter to legal, then sample.** The order is the whole correctness argument
 * here, and it is not a defensive nicety: the charts open to 2.5bb, and a seat
 * with 1.8bb behind cannot raise to 2.5. Sampling first and repairing after
 * would change the mix — the repaired action gets the raise's frequency added
 * to whatever it collapses into — while sampling from the legal subset keeps
 * the surviving frequencies in their original proportions.
 *
 * A bot that emits an illegal action does not misplay a pot. `applyAction`
 * throws and the session ends, so this is correctness rather than strategy.
 */

import type { Answer } from '../drills';
import type { LegalAction } from '../game';
import type { ActionFreq } from '../ranges';
import type { Rng } from '../rng';
import type { ActionRecommendation } from '../strategy';

/** Two decimals, matching the money column everything else rounds to. */
function chips(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * The entry, coerced into what this seat may actually do, or `undefined` if it
 * cannot do it at all.
 *
 * A size outside `[minTo, maxTo]` is clamped rather than dropped. A chart
 * saying "raise to 2.5" against a stack that can only reach 1.8 still means
 * *raise*, and raising to the most it can is much closer to the chart's intent
 * than folding.
 */
function coerce(entry: ActionFreq, legal: readonly LegalAction[]): ActionFreq | undefined {
  const option = legal.find((candidate) => candidate.action === entry.action);
  if (option === undefined) return undefined;

  if (option.minTo === undefined && option.maxTo === undefined) {
    // Unsized action. Any size on the entry is meaningless and is dropped
    // rather than carried into `applyAction`, which would reject it.
    return { action: entry.action, freq: entry.freq };
  }

  const low = option.minTo ?? 0;
  const high = option.maxTo ?? Number.POSITIVE_INFINITY;

  // A window that has closed — the stack cannot reach the minimum raise.
  if (high < low) return undefined;

  return {
    action: entry.action,
    size: chips(Math.min(high, Math.max(low, entry.size ?? low))),
    freq: entry.freq,
  };
}

/**
 * The action to take when the recommendation names nothing this seat can do.
 *
 * Checking is free and can never be a mistake, so it wins whenever it is on
 * offer. Folding is the last resort and deliberately last: a bot that folded
 * rather than checking would be giving away pots it was still in for nothing.
 */
function mostPassive(legal: readonly LegalAction[]): LegalAction {
  return (
    legal.find((option) => option.action === 'check') ??
    legal.find((option) => option.action === 'fold') ??
    legal[0]!
  );
}

export function sampleAction(
  recommendation: ActionRecommendation,
  legal: readonly LegalAction[],
  rng: Rng,
): Answer {
  if (legal.length === 0) {
    throw new RangeError('there is no legal action to sample');
  }

  const usable: ActionFreq[] = [];
  for (const entry of recommendation.frequencies) {
    const coerced = coerce(entry, legal);
    if (coerced !== undefined && coerced.freq > 0) usable.push(coerced);
  }

  const total = usable.reduce((sum, entry) => sum + entry.freq, 0);

  if (total <= 0) {
    const fallback = mostPassive(legal);
    return {
      action: fallback.action,
      ...(fallback.minTo !== undefined ? { size: chips(fallback.minTo) } : {}),
    };
  }

  // Renormalised over what survived, so dropping a 90% raise leaves the
  // remaining 10% call as the whole distribution rather than a 10% chance of
  // anything happening.
  const roll = rng.nextFloat() * total;

  let cumulative = 0;
  for (const entry of usable) {
    cumulative += entry.freq;
    if (roll < cumulative) {
      return { action: entry.action, ...(entry.size !== undefined ? { size: entry.size } : {}) };
    }
  }

  // Float summation can leave `roll` a hair above the final boundary.
  const last = usable[usable.length - 1]!;
  return { action: last.action, ...(last.size !== undefined ? { size: last.size } : {}) };
}
