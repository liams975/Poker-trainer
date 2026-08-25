/**
 * The reference evaluator: slow, obviously correct, and permanent.
 *
 * docs/03-poker-engine.md: "Keep the naive evaluator in the repo forever as the
 * oracle. This pattern turns 'is my evaluator right?' from a matter of faith
 * into a test."
 *
 * It enumerates every five-card subset of the hand and ranks each by the rules
 * as written in a rulebook — sorted ranks, a count per rank, a flush check, a
 * straight check. No bit tricks, no lookup tables, nothing clever. Every
 * decision here should be checkable by reading it.
 *
 * Do not optimise this file. Its only job is to be right.
 */

import type { Card } from '../cards';
import { rankOf, suitOf } from '../cards';

import type { HandValue } from './hand-value';
import { HandCategory, packHandValue } from './hand-value';

const WHEEL_RANKS = [12, 3, 2, 1, 0]; // A 5 4 3 2, descending

function straightHighOf(descendingDistinctRanks: number[]): number {
  if (descendingDistinctRanks.length !== 5) return -1;

  const [a, , , , e] = descendingDistinctRanks as [number, number, number, number, number];

  if (a - e === 4) return a;

  // The wheel is the one straight whose ace plays low, so it ranks as a
  // five-high straight rather than an ace-high one.
  const isWheel = descendingDistinctRanks.every((r, i) => r === WHEEL_RANKS[i]);
  return isWheel ? 3 : -1;
}

function rankFiveCards(hand: readonly Card[]): HandValue {
  const ranks = hand.map(rankOf).sort((a, b) => b - a);
  const suits = hand.map(suitOf);

  const isFlush = suits.every((s) => s === suits[0]);
  const straightHigh = straightHighOf([...new Set(ranks)]);

  // Ranks grouped by how many times they appear, most frequent first and then
  // highest first. That single ordering yields the tiebreakers for every
  // count-based category: [quad, kicker], [trips, pair], [pair, pair, kicker],
  // and so on.
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);

  const groups = [...counts.entries()].sort(
    ([rankA, countA], [rankB, countB]) => countB - countA || rankB - rankA,
  );
  const groupRank = (i: number): number => groups[i]![0];
  const groupCount = (i: number): number => groups[i]![1];

  if (isFlush && straightHigh >= 0) {
    return packHandValue(HandCategory.StraightFlush, straightHigh);
  }
  if (groupCount(0) === 4) {
    return packHandValue(HandCategory.Quads, groupRank(0), groupRank(1));
  }
  if (groupCount(0) === 3 && groupCount(1) === 2) {
    return packHandValue(HandCategory.FullHouse, groupRank(0), groupRank(1));
  }
  if (isFlush) {
    return packHandValue(HandCategory.Flush, ranks[0]!, ranks[1]!, ranks[2]!, ranks[3]!, ranks[4]!);
  }
  if (straightHigh >= 0) {
    return packHandValue(HandCategory.Straight, straightHigh);
  }
  if (groupCount(0) === 3) {
    return packHandValue(HandCategory.Trips, groupRank(0), groupRank(1), groupRank(2));
  }
  if (groupCount(0) === 2 && groupCount(1) === 2) {
    return packHandValue(HandCategory.TwoPair, groupRank(0), groupRank(1), groupRank(2));
  }
  if (groupCount(0) === 2) {
    return packHandValue(
      HandCategory.Pair,
      groupRank(0),
      groupRank(1),
      groupRank(2),
      groupRank(3),
    );
  }

  return packHandValue(HandCategory.HighCard, ranks[0]!, ranks[1]!, ranks[2]!, ranks[3]!, ranks[4]!);
}

/** Best five-card value of a five-, six- or seven-card hand. */
export function evaluateNaive(cards: readonly Card[]): HandValue {
  const n = cards.length;
  if (n < 5 || n > 7) {
    throw new RangeError(`expected 5 to 7 cards, got ${n}`);
  }

  let best = -1;

  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            const value = rankFiveCards([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (value > best) best = value;
          }
        }
      }
    }
  }

  return best;
}
