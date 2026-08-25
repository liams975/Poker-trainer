/**
 * A range: each of the 169 canonical hands mapped to a distribution over
 * actions whose frequencies sum to 1.0.
 *
 * Mixed strategies are the normal case, not an edge case
 * (.claude/skills/poker-domain/SKILL.md). `AJo` from the cutoff might be 60%
 * open / 40% fold. There is deliberately no function here that answers "what
 * should I do with AJo" — the distribution *is* the answer, and any accessor
 * that collapsed it would be teaching the wrong thing.
 *
 * Storage is compact: a chart lists only the hands that do something other
 * than fold, so a UTG opening range is about thirty lines of JSON rather than
 * 169. `handStrategy` hides that entirely — it always returns a full
 * distribution, so no consumer can tell a listed pure fold from an absent one.
 */

import type { HandNotation } from '../cards';
import { CANONICAL_HANDS } from '../cards';

import type { Action } from './action';
import { aggressionRank } from './action';

/**
 * One action and how often it is taken. `size` is in big blinds and is carried
 * only by `bet` and `raise` — two entries for the same action with different
 * sizes is a legitimate mix, not a duplicate.
 */
export interface ActionFreq {
  action: Action;
  size?: number;
  /** In (0, 1]. */
  freq: number;
}

export type Range = Readonly<Record<HandNotation, readonly ActionFreq[]>>;

/**
 * Float slack for "frequencies sum to 1.0". Authored charts are decimal
 * literals, so the error is a few ULPs, never accumulation.
 */
export const FREQ_TOLERANCE = 1e-6;

/** What an unlisted hand resolves to. Frozen: it is shared by every caller. */
export const ALWAYS_FOLD: readonly ActionFreq[] = Object.freeze([
  Object.freeze<ActionFreq>({ action: 'fold', freq: 1 }),
]);

const CANONICAL = new Set<string>(CANONICAL_HANDS);

/**
 * The full distribution for a hand. Never returns undefined and never returns
 * a partial distribution.
 *
 * Throws on a hand outside the 169. That check is the other half of the
 * absent-means-fold convention: without it a typo like `AJ0` would silently
 * resolve to a pure fold and look like a deliberate charting decision.
 */
export function handStrategy(range: Range, hand: HandNotation): readonly ActionFreq[] {
  if (!CANONICAL.has(hand)) {
    throw new RangeError(`"${hand}" is not one of the 169 canonical hands`);
  }

  return range[hand] ?? ALWAYS_FOLD;
}

export function frequencySum(freqs: readonly ActionFreq[]): number {
  let total = 0;
  for (const entry of freqs) total += entry.freq;
  return total;
}

/** Total frequency of an action, summed across sizes. */
export function frequencyOf(freqs: readonly ActionFreq[], action: Action): number {
  let total = 0;
  for (const entry of freqs) {
    if (entry.action === action) total += entry.freq;
  }
  return total;
}

export function foldFrequency(freqs: readonly ActionFreq[]): number {
  return frequencyOf(freqs, 'fold');
}

/**
 * The highest-frequency entry, for display and for the `primary` field of
 * docs/03-poker-engine.md's ActionRecommendation.
 *
 * Ties are real — a genuine coin-flip hand has two equally optimal actions,
 * and Phase 3 grading must treat both as optimal rather than consulting this
 * function. But the choice still has to be stable, because a replayed drill
 * that displayed a different primary than the one the user answered against
 * would look like a bug. Tiebreak: more aggressive action first, then larger
 * size.
 */
export function primaryAction(freqs: readonly ActionFreq[]): ActionFreq {
  if (freqs.length === 0) {
    throw new RangeError('a hand strategy cannot be empty');
  }

  let best = freqs[0]!;

  for (let i = 1; i < freqs.length; i++) {
    const candidate = freqs[i]!;
    if (candidate.freq > best.freq) {
      best = candidate;
      continue;
    }
    if (candidate.freq < best.freq) continue;

    const byAggression = aggressionRank(candidate.action) - aggressionRank(best.action);
    if (byAggression > 0 || (byAggression === 0 && (candidate.size ?? 0) > (best.size ?? 0))) {
      best = candidate;
    }
  }

  return best;
}
