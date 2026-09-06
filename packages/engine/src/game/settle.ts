/**
 * Ending a hand: rank what is left, move the chips.
 *
 * The other half of what `betting.ts` recorded as missing — "side pots are not
 * split, and no showdown is awarded". `pot.ts` does the splitting; this does the
 * awarding, and it is the only place in the engine that moves chips back to a
 * stack.
 *
 * Two rules here are silent when wrong, so both are written down rather than
 * left to fall out of an implementation:
 *
 *   1. **Odd chips go to the first eligible seat left of the button.** Amounts
 *      are two decimal places to match `drill_attempts.user_size numeric(6,2)`,
 *      so a three-way chop of an odd pot leaves a remainder. `Pot.eligible`
 *      arrives in postflop action order — which starts at the small blind —
 *      precisely so that "first in the list" *is* the rule and not an accident
 *      of how the seats happened to be arrayed.
 *   2. **A folded-out pot has no showdown.** One seat left means no cards are
 *      ranked and none are revealed. `HandResult.showdown` is `undefined`
 *      rather than empty, so a caller cannot accidentally treat "nobody had to
 *      show" as "nobody had anything".
 */

import type { HandValue } from '../evaluator';
import { evaluate } from '../evaluator';
import type { Position } from '../ranges';

import type { HandState, Seat } from './hand-state';
import { chips, contestingSeats } from './hand-state';
import type { Pot, UncalledPortion } from './pot';
import { buildPots, uncalledPortion } from './pot';

/** A full board. Nothing may be ranked before the river is out. */
const FULL_BOARD = 5;

export interface PotAward {
  amount: number;
  eligible: readonly Position[];
  /** Eligible seats holding the best hand. Ordered as `eligible` is. */
  winners: readonly Position[];
  /** What each winner took, aligned with `winners`. Sums to `amount`. */
  shares: readonly number[];
}

export interface SeatPayout {
  position: Position;
  /** Everything coming back: pot winnings plus any uncalled bet returned. */
  won: number;
  /** `won - totalCommitted`. What the hand was worth to this seat. */
  net: number;
}

export interface ShowdownEntry {
  position: Position;
  value: HandValue;
}

export interface HandResult {
  pots: readonly PotAward[];
  payouts: readonly SeatPayout[];
  /** Undefined when the hand ended without one — not an empty array. */
  showdown: readonly ShowdownEntry[] | undefined;
  uncalled: UncalledPortion | undefined;
}

/**
 * Splits an amount `winners.length` ways in whole cents.
 *
 * Done in integer cents rather than by dividing and rounding each share: three
 * shares of 10.003333 all round to 10.00 and lose a cent, and a cent lost every
 * few thousand hands is exactly the kind of drift the conservation test exists
 * to catch. The remainder is handed out one cent at a time from the front of
 * the list, which is the first seat left of the button.
 */
function splitEvenly(amount: number, ways: number): number[] {
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / ways);
  const remainder = cents - base * ways;

  return Array.from({ length: ways }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}

function requireCards(seat: Seat): void {
  if (seat.hole === undefined) {
    throw new RangeError(
      `${seat.position} is still contesting the pot but has no cards to show`,
    );
  }
}

export function settleHand(state: HandState): { state: HandState; result: HandResult } {
  if (state.toAct !== undefined) {
    throw new RangeError(`the hand is not complete; ${state.toAct} is still acting`);
  }

  const contesting = contestingSeats(state);
  const uncalled = uncalledPortion(state);
  const pots = buildPots(state);

  /**
   * A pot with one eligible seat needs no ranking, and neither does a hand
   * everyone folded out of. Checked per pot rather than once for the hand: a
   * side pot can be uncontested — two players call an all-in and one of them
   * then folds — while the main pot still goes to showdown.
   */
  const contested = pots.some((pot) => pot.eligible.length > 1);

  let ranked: Map<Position, HandValue> | undefined;

  if (contested) {
    if (state.board.length !== FULL_BOARD) {
      throw new RangeError(
        `a contested pot needs a complete board, got ${state.board.length} card(s)`,
      );
    }

    ranked = new Map();
    for (const seat of contesting) {
      requireCards(seat);
      ranked.set(seat.position, evaluate([seat.hole![0], seat.hole![1], ...state.board]));
    }
  }

  const won = new Map<Position, number>(state.seats.map((seat) => [seat.position, 0]));
  const add = (position: Position, amount: number): void => {
    won.set(position, chips((won.get(position) ?? 0) + amount));
  };

  if (uncalled) add(uncalled.position, uncalled.amount);

  const awards: PotAward[] = [];

  for (const pot of pots) {
    const winners = winnersOf(pot, ranked);
    const shares = splitEvenly(pot.amount, winners.length);

    winners.forEach((position, index) => add(position, shares[index]!));
    awards.push({ amount: pot.amount, eligible: pot.eligible, winners, shares });
  }

  const payouts: SeatPayout[] = state.seats.map((seat) => ({
    position: seat.position,
    won: won.get(seat.position) ?? 0,
    net: chips((won.get(seat.position) ?? 0) - seat.totalCommitted),
  }));

  /**
   * Committed chips are zeroed as the stacks are credited. Leaving
   * `totalCommitted` populated would double-count the hand in any later sum of
   * "chips on the table", which is the sum the conservation test takes.
   */
  const settled: HandState = {
    ...state,
    seats: state.seats.map((seat) => ({
      ...seat,
      stack: chips(seat.stack + (won.get(seat.position) ?? 0)),
      committed: 0,
      totalCommitted: 0,
    })),
  };

  return {
    state: settled,
    result: {
      pots: awards,
      payouts,
      showdown: ranked
        ? contesting.map((seat) => ({ position: seat.position, value: ranked.get(seat.position)! }))
        : undefined,
      uncalled,
    },
  };
}

/** The eligible seats holding the best hand, in the order chips are paid. */
function winnersOf(pot: Pot, ranked: Map<Position, HandValue> | undefined): readonly Position[] {
  if (pot.eligible.length <= 1) return pot.eligible;

  const best = pot.eligible.reduce(
    (top, position) => Math.max(top, ranked?.get(position) ?? 0),
    -1,
  );

  return pot.eligible.filter((position) => (ranked?.get(position) ?? 0) === best);
}
