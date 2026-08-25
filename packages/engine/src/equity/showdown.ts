/**
 * The pieces both equity paths share: deck bookkeeping and the showdown award.
 *
 * Kept separate from the two algorithms so that exact enumeration and Monte
 * Carlo sampling cannot drift apart on how a pot is split — they differ only in
 * which runouts they look at, never in how a runout is scored.
 */

import type { Card } from '../cards';
import { FULL_DECK } from '../cards';
import type { HandValue } from '../evaluator';

export interface EquityResult {
  /**
   * Hero's share of the pot, in [0, 1]. Split pots contribute a fraction, so
   * this is the number to use for EV — not `win`.
   */
  equity: number;
  /** Fraction of runouts hero wins outright. */
  win: number;
  /** Fraction of runouts hero splits with at least one opponent. */
  tie: number;
  /** Fraction of runouts hero loses. */
  lose: number;
  /** How many runouts were scored. */
  trials: number;
}

export interface Tally {
  win: number;
  tie: number;
  lose: number;
  share: number;
}

export function createTally(): Tally {
  return { win: 0, tie: 0, lose: 0, share: 0 };
}

/**
 * Scores one completed runout. A split among k players awards hero 1/k, which
 * generalises to any number of opponents — a three-way pot two players chop is
 * scored correctly without a special case.
 */
export function recordShowdown(
  tally: Tally,
  hero: HandValue,
  villains: readonly HandValue[],
): void {
  let tiedWith = 0;

  for (let i = 0; i < villains.length; i++) {
    const villain = villains[i]!;
    if (villain > hero) {
      tally.lose += 1;
      return;
    }
    if (villain === hero) tiedWith += 1;
  }

  if (tiedWith === 0) {
    tally.win += 1;
    tally.share += 1;
  } else {
    tally.tie += 1;
    tally.share += 1 / (tiedWith + 1);
  }
}

export function toEquityResult(tally: Tally, trials: number): EquityResult {
  return {
    equity: tally.share / trials,
    win: tally.win / trials,
    tie: tally.tie / trials,
    lose: tally.lose / trials,
    trials,
  };
}

/**
 * The deck with `dead` removed, in deck order.
 *
 * Deck order, not the caller's order, is what makes Monte Carlo symmetric:
 * `monteCarloEquity(a, [b])` and `monteCarloEquity(b, [a])` see the identical
 * remaining deck and therefore the identical runouts under the same seed.
 */
export function deckWithout(dead: readonly Card[]): Card[] {
  const blocked = new Set<number>(dead);
  return FULL_DECK.filter((card) => !blocked.has(card));
}
