/**
 * The fast evaluator: rank histogram plus bitmasks.
 *
 * Returns exactly the same packed `HandValue` as `evaluateNaive` for every
 * input. Where the naive one enumerates 21 five-card subsets, this one reads
 * the hand once and derives the answer from a rank bitmask, a per-rank count
 * and a per-suit mask.
 *
 * Straights are the only part that needs a table, and it is computed here at
 * module load rather than shipped as data: a generated lookup file (or a
 * Cactus-Kev style perfect hash) would be faster still, but it needs either a
 * build step or a binary asset, and `packages/engine` is asserted in CI to have
 * zero runtime dependencies so it can move to a React Native runtime unchanged.
 *
 * Trust in this file comes from tests/evaluator.oracle.test.ts, which pins it
 * against the naive implementation over a million random hands.
 */

import type { Card } from '../cards';

import type { HandValue } from './hand-value';
import { HandCategory, packHandValue } from './hand-value';

const RANK_COUNT = 13;
const SUIT_COUNT = 4;
const MASK_COUNT = 1 << RANK_COUNT;

/** A 5 4 3 2 — the one straight whose ace plays low. */
const WHEEL_MASK = (1 << 12) | (1 << 3) | (1 << 2) | (1 << 1) | 1;

/**
 * Indexed by a 13-bit rank mask: the high rank of the best straight it
 * contains, or -1. 8192 entries, filled in about 70k operations at load.
 */
const STRAIGHT_HIGH: Int8Array = (() => {
  const table = new Int8Array(MASK_COUNT).fill(-1);

  for (let mask = 0; mask < MASK_COUNT; mask++) {
    for (let high = 12; high >= 4; high--) {
      const needed = 0b11111 << (high - 4);
      if ((mask & needed) === needed) {
        table[mask] = high;
        break;
      }
    }

    // Checked only if no ace-high-playing straight was found, so a hand holding
    // both the wheel and a better straight keeps the better one.
    if (table[mask] === -1 && (mask & WHEEL_MASK) === WHEEL_MASK) {
      table[mask] = 3;
    }
  }

  return table;
})();

/**
 * Reused across calls rather than allocated per call. `evaluate` is
 * synchronous, calls nothing that could re-enter it, and clears these before
 * use, so the reuse is invisible to callers — but it removes three allocations
 * from a path that runs tens of millions of times in the oracle run.
 */
const rankCounts = new Int8Array(RANK_COUNT);
const suitCounts = new Int8Array(SUIT_COUNT);
const suitMasks = new Int16Array(SUIT_COUNT);

/** Highest set bit's index, or -1 for an empty mask. */
function highestRank(mask: number): number {
  return 31 - Math.clz32(mask);
}

/** Packs the top five ranks of a mask as the tiebreakers. */
function packTopFive(category: HandCategory, mask: number): HandValue {
  let value = category << 20;
  let shift = 16;

  for (let rank = 12; rank >= 0 && shift >= 0; rank--) {
    if ((mask & (1 << rank)) !== 0) {
      value |= rank << shift;
      shift -= 4;
    }
  }

  return value;
}

/** Best five-card value of a five-, six- or seven-card hand. */
export function evaluate(cards: readonly Card[]): HandValue {
  const n = cards.length;
  if (n < 5 || n > 7) {
    throw new RangeError(`expected 5 to 7 cards, got ${n}`);
  }

  rankCounts.fill(0);
  suitCounts.fill(0);
  suitMasks.fill(0);
  let rankMask = 0;

  for (let i = 0; i < n; i++) {
    const card = cards[i]!;
    const rank = card >>> 2;
    const suit = card & 3;

    rankCounts[rank] = rankCounts[rank]! + 1;
    suitCounts[suit] = suitCounts[suit]! + 1;
    suitMasks[suit] = suitMasks[suit]! | (1 << rank);
    rankMask |= 1 << rank;
  }

  // Flushes are resolved first and returned immediately, which is safe because
  // a hand of seven cards cannot contain both a flush and anything that beats
  // one. Quads occupy all four suits, so they contribute one card per suit. A
  // full house's five cards are three of one rank (three different suits) and
  // two of another (two different suits), so at most two of them share a suit;
  // the two cards outside it cannot lift that to five.
  let flushSuit = -1;
  for (let suit = 0; suit < SUIT_COUNT; suit++) {
    if (suitCounts[suit]! >= 5) {
      flushSuit = suit;
      break;
    }
  }

  if (flushSuit >= 0) {
    const flushMask = suitMasks[flushSuit]!;
    const straightFlushHigh = STRAIGHT_HIGH[flushMask]!;

    return straightFlushHigh >= 0
      ? packHandValue(HandCategory.StraightFlush, straightFlushHigh)
      : packTopFive(HandCategory.Flush, flushMask);
  }

  let quad = -1;
  let tripsHigh = -1;
  let tripsLow = -1;
  let pairHigh = -1;
  let pairLow = -1;

  for (let rank = 12; rank >= 0; rank--) {
    switch (rankCounts[rank]!) {
      case 4:
        quad = rank;
        break;
      case 3:
        if (tripsHigh < 0) tripsHigh = rank;
        else if (tripsLow < 0) tripsLow = rank;
        break;
      case 2:
        if (pairHigh < 0) pairHigh = rank;
        else if (pairLow < 0) pairLow = rank;
        break;
      default:
        break;
    }
  }

  if (quad >= 0) {
    // The kicker is the best remaining rank, which need not be a singleton —
    // quads over trips is a real seven-card hand.
    return packHandValue(HandCategory.Quads, quad, highestRank(rankMask & ~(1 << quad)));
  }

  if (tripsHigh >= 0) {
    // A second set of trips can only ever play as the pair.
    const pairRank = pairHigh > tripsLow ? pairHigh : tripsLow;
    if (pairRank >= 0) {
      return packHandValue(HandCategory.FullHouse, tripsHigh, pairRank);
    }
  }

  const straightHigh = STRAIGHT_HIGH[rankMask]!;
  if (straightHigh >= 0) {
    return packHandValue(HandCategory.Straight, straightHigh);
  }

  if (tripsHigh >= 0) {
    const rest = rankMask & ~(1 << tripsHigh);
    const first = highestRank(rest);
    const second = highestRank(rest & ~(1 << first));
    return packHandValue(HandCategory.Trips, tripsHigh, first, second);
  }

  if (pairLow >= 0) {
    // With three pairs the lowest one is not discarded — it supplies the kicker.
    const kicker = highestRank(rankMask & ~(1 << pairHigh) & ~(1 << pairLow));
    return packHandValue(HandCategory.TwoPair, pairHigh, pairLow, kicker);
  }

  if (pairHigh >= 0) {
    const rest = rankMask & ~(1 << pairHigh);
    const first = highestRank(rest);
    const second = highestRank(rest & ~(1 << first));
    const third = highestRank(rest & ~(1 << first) & ~(1 << second));
    return packHandValue(HandCategory.Pair, pairHigh, first, second, third);
  }

  return packTopFive(HandCategory.HighCard, rankMask);
}
