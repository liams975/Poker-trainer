/**
 * Equity: how often a hand wins by the river.
 *
 * Two implementations, layered the way the evaluator is. `exactEquity`
 * enumerates every remaining runout and is ground truth. `monteCarloEquity`
 * samples, and is checked against the exact one in tests rather than against a
 * published table. Exact enumeration is cheap from the flop on (990 runouts)
 * and affordable preflop (C(48,5) = 1,712,304); Monte Carlo is what the app
 * calls when it needs an answer in milliseconds.
 *
 * Hand-vs-range takes plain hand notations (`['AKs', 'QQ']`) rather than a
 * weighted `Range`. The weighted range type and the charts arrive in Phase 2
 * and will convert down to this; keeping Phase 2's type out of Phase 1 means
 * the seam is a conversion, not a rewrite.
 */

import type { Card, Combo, HandNotation } from '../cards';
import { combosOf, formatCards } from '../cards';
import { evaluate } from '../evaluator';
import type { Rng } from '../rng';

import type { EquityResult } from './showdown';
import {
  createTally,
  deckWithout,
  recordShowdown,
  requireDistinctCards,
  toEquityResult,
} from './showdown';

export type { EquityResult } from './showdown';

const BOARD_SIZE = 5;
const DEFAULT_TRIALS = 10_000;

export interface MonteCarloOptions {
  /**
   * Required, not defaulted. An equity number that cannot be reproduced is a
   * number you cannot debug, and docs/03-poker-engine.md makes every source of
   * randomness injected.
   */
  rng: Rng;
  trials?: number;
  /** 0, 3, 4 or 5 cards. Omit for preflop. */
  board?: readonly Card[];
}

interface Setup {
  remaining: Card[];
  needed: number;
  heroHand: Card[];
  villainHands: Card[][];
}

function setUp(hero: Combo, villains: readonly Combo[], board: readonly Card[]): Setup {
  if (villains.length === 0) {
    throw new RangeError('equity needs at least one opponent');
  }
  if (board.length !== 0 && (board.length < 3 || board.length > BOARD_SIZE)) {
    throw new RangeError(`a board has 0, 3, 4 or 5 cards, got ${board.length}`);
  }

  const known: Card[] = [...hero, ...board];
  for (const villain of villains) known.push(villain[0], villain[1]);
  requireDistinctCards(known);

  const needed = BOARD_SIZE - board.length;
  // Seven slots: two hole cards, the known board, then room for the runout.
  const blank = Array.from({ length: needed }, () => 0 as Card);

  return {
    remaining: deckWithout(known),
    needed,
    heroHand: [hero[0], hero[1], ...board, ...blank],
    villainHands: villains.map((v) => [v[0], v[1], ...board, ...blank]),
  };
}

/** Enumerates every remaining runout. Exact, and the oracle for the sampler. */
export function exactEquity(
  hero: Combo,
  villains: readonly Combo[],
  board: readonly Card[] = [],
): EquityResult {
  const { remaining, needed, heroHand, villainHands } = setUp(hero, villains, board);

  const tally = createTally();
  const slot = 2 + board.length;
  const villainValues = new Array<number>(villainHands.length);
  let trials = 0;

  const score = (): void => {
    for (let v = 0; v < villainHands.length; v++) {
      villainValues[v] = evaluate(villainHands[v]!);
    }
    recordShowdown(tally, evaluate(heroHand), villainValues);
    trials += 1;
  };

  const deal = (start: number, depth: number): void => {
    if (depth === needed) {
      score();
      return;
    }

    // Leave enough cards behind to finish the board.
    const last = remaining.length - (needed - depth);
    for (let i = start; i <= last; i++) {
      const card = remaining[i]!;
      heroHand[slot + depth] = card;
      for (const villainHand of villainHands) villainHand[slot + depth] = card;
      deal(i + 1, depth + 1);
    }
  };

  deal(0, 0);

  return toEquityResult(tally, trials);
}

/** Samples runouts. Deterministic for a given seeded `rng`. */
export function monteCarloEquity(
  hero: Combo,
  villains: readonly Combo[],
  options: MonteCarloOptions,
): EquityResult {
  const { rng, trials = DEFAULT_TRIALS, board = [] } = options;

  if (!Number.isInteger(trials) || trials < 1) {
    throw new RangeError(`trials must be a positive integer, got ${trials}`);
  }

  const { remaining, needed, heroHand, villainHands } = setUp(hero, villains, board);
  const tally = createTally();
  const slot = 2 + board.length;
  const villainValues = new Array<number>(villainHands.length);

  for (let t = 0; t < trials; t++) {
    // Partial Fisher-Yates: only the cards the board still needs are drawn.
    // The deck stays permuted between trials, which keeps every draw uniform
    // without rebuilding the array.
    for (let i = 0; i < needed; i++) {
      const j = i + rng.nextInt(remaining.length - i);
      const held = remaining[i]!;
      remaining[i] = remaining[j]!;
      remaining[j] = held;

      const card = remaining[i]!;
      heroHand[slot + i] = card;
      for (const villainHand of villainHands) villainHand[slot + i] = card;
    }

    for (let v = 0; v < villainHands.length; v++) {
      villainValues[v] = evaluate(villainHands[v]!);
    }
    recordShowdown(tally, evaluate(heroHand), villainValues);
  }

  return toEquityResult(tally, trials);
}

/**
 * The concrete combos a set of hand notations can still hold, given cards that
 * are already visible.
 *
 * Card removal is not a detail: an opponent's `AA` is six combos in the
 * abstract but only one when hero holds two aces himself, and ignoring that
 * overstates how often he is beaten.
 */
export function rangeCombos(
  hands: readonly HandNotation[],
  dead: readonly Card[],
): Combo[] {
  const blocked = new Set<number>(dead);
  const seen = new Set<number>();
  const combos: Combo[] = [];

  for (const hand of hands) {
    for (const combo of combosOf(hand)) {
      if (blocked.has(combo[0]) || blocked.has(combo[1])) continue;

      // Notations can overlap in a caller-supplied list; a combo must not be
      // sampled twice as often just because it was named twice.
      const key = combo[0] * 52 + combo[1];
      if (seen.has(key)) continue;
      seen.add(key);

      combos.push(combo);
    }
  }

  return combos;
}

/**
 * Hero against one opponent holding an unweighted range of hand notations.
 * Each trial draws an unblocked villain combo, then a runout.
 */
export function equityVsHands(
  hero: Combo,
  villainHands: readonly HandNotation[],
  options: MonteCarloOptions,
): EquityResult {
  const { rng, trials = DEFAULT_TRIALS, board = [] } = options;

  if (!Number.isInteger(trials) || trials < 1) {
    throw new RangeError(`trials must be a positive integer, got ${trials}`);
  }

  const dead: Card[] = [...hero, ...board];
  requireDistinctCards(dead);

  const candidates = rangeCombos(villainHands, dead);
  if (candidates.length === 0) {
    throw new RangeError(
      `every combo in [${villainHands.join(', ')}] is blocked by the known cards`,
    );
  }

  const needed = BOARD_SIZE - board.length;
  if (board.length !== 0 && (board.length < 3 || board.length > BOARD_SIZE)) {
    throw new RangeError(`a board has 0, 3, 4 or 5 cards, got ${board.length}`);
  }

  // One deck for the whole run, with `position` tracking where each card is so
  // the villain's two cards can be lifted out of the sampling region in O(1)
  // rather than by rebuilding the deck every trial.
  const deck = deckWithout(dead);
  const position = new Int8Array(52).fill(-1);
  for (let i = 0; i < deck.length; i++) position[deck[i]!] = i;

  // Unreachable while `rangeCombos` filters against the same dead cards the
  // deck was built from. Kept because the failure it guards is silent: a -1
  // position would write `deck[-1]` as a stray object property, corrupt the
  // sampling region and return a plausible wrong equity rather than throwing.
  for (const candidate of candidates) {
    if (position[candidate[0]]! < 0 || position[candidate[1]]! < 0) {
      throw new RangeError(`${formatCards(candidate)} is not in the remaining deck`);
    }
  }

  const swap = (i: number, j: number): void => {
    const a = deck[i]!;
    const b = deck[j]!;
    deck[i] = b;
    deck[j] = a;
    position[b] = i;
    position[a] = j;
  };

  const tally = createTally();
  const slot = 2 + board.length;
  const heroHand: Card[] = [hero[0], hero[1], ...board, ...Array.from({ length: needed }, () => 0 as Card)];
  const villainHand: Card[] = [0 as Card, 0 as Card, ...board, ...Array.from({ length: needed }, () => 0 as Card)];
  const villainValues = new Array<number>(1);

  for (let t = 0; t < trials; t++) {
    const villain = candidates[rng.nextInt(candidates.length)]!;

    // Park the villain's cards past the end of the sampling region.
    swap(position[villain[0]]!, deck.length - 1);
    swap(position[villain[1]]!, deck.length - 2);
    const drawable = deck.length - 2;

    villainHand[0] = villain[0];
    villainHand[1] = villain[1];

    for (let i = 0; i < needed; i++) {
      const j = i + rng.nextInt(drawable - i);
      swap(i, j);

      const card = deck[i]!;
      heroHand[slot + i] = card;
      villainHand[slot + i] = card;
    }

    villainValues[0] = evaluate(villainHand);
    recordShowdown(tally, evaluate(heroHand), villainValues);
  }

  return toEquityResult(tally, trials);
}
