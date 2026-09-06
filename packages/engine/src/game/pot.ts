/**
 * Side pots.
 *
 * `betting.ts` has carried this omission since Phase 3 — "side pots are not
 * split, and no showdown is awarded" — because v1 only ever drilled a single
 * preflop decision and never finished a hand. Phase 12a finishes hands.
 *
 * Deliberately **arithmetic only**: nothing here evaluates a hand or knows what
 * a winner is. `settle.ts` does that. Keeping the split separate means it can
 * be tested exhaustively against contribution patterns without dealing a card,
 * and a side-pot bug is exactly the kind that hides behind a plausible-looking
 * showdown.
 *
 * The contract the whole hand rests on:
 *
 *     sum(buildPots) + uncalledPortion == sum(totalCommitted)
 *
 * Chip conservation over a long simulation is the headline exit criterion for
 * this phase, and it reduces to that line.
 */

import type { Position } from '../ranges';

import type { HandState } from './hand-state';
import { actionOrder, chips } from './hand-state';

export interface Pot {
  amount: number;
  /**
   * Seats that can win this pot, in the order chips are awarded — first left of
   * the button, which is where postflop action already starts. The order is not
   * cosmetic: it is the odd-chip rule in `settle.ts`.
   */
  eligible: readonly Position[];
}

export interface UncalledPortion {
  position: Position;
  amount: number;
}

/**
 * The part of the largest bet nobody matched, which goes back to whoever bet it.
 *
 * Measured against **every** seat, folded ones included, because a folded seat's
 * chips were still called money — a seat that put in 20 before folding caps what
 * comes back to the shover at the excess over 20, not over zero.
 *
 * Deriving this rather than special-casing it means "everyone folds to the big
 * blind" needs no rule of its own: the big blind is the top contributor, the
 * small blind is the second, and 0.5bb comes back. The big blind nets exactly
 * the small blind, which is what winning the blinds is.
 */
export function uncalledPortion(state: HandState): UncalledPortion | undefined {
  let top: { position: Position; amount: number } | undefined;
  let second = 0;

  for (const seat of state.seats) {
    const put = seat.totalCommitted;

    if (top === undefined || put > top.amount) {
      if (top !== undefined) second = Math.max(second, top.amount);
      top = { position: seat.position, amount: put };
    } else {
      second = Math.max(second, put);
    }
  }

  if (top === undefined) return undefined;

  const excess = chips(top.amount - second);
  if (excess <= 0) return undefined;

  return { position: top.position, amount: excess };
}

/**
 * The pots, in order: main pot first, then each side pot outward.
 *
 * One layer per distinct depth among the seats still contesting. A seat all-in
 * for 20 against two players in for 50 can only win the 20-level layer, and the
 * 30 above it is contested by the two who covered him.
 *
 * Folded seats never appear in `eligible`, but their chips are still counted
 * into whichever layers they reached — a fold does not remove money from the
 * pot, and it does not necessarily put all of it in the main pot either. A seat
 * that called 35 before folding leaves 20 in a 20-level main pot and 15 in the
 * side pot above it.
 */
export function buildPots(state: HandState): readonly Pot[] {
  const uncalled = uncalledPortion(state);

  // Contributions with the uncalled excess already taken out, so the layers
  // below never contain money that is on its way back to somebody.
  const put = new Map<Position, number>(
    state.seats.map((seat) => [
      seat.position,
      seat.position === uncalled?.position
        ? chips(seat.totalCommitted - uncalled.amount)
        : seat.totalCommitted,
    ]),
  );

  const contesting = state.seats.filter((seat) => seat.status !== 'folded');

  const levels = [
    ...new Set(contesting.map((seat) => put.get(seat.position) ?? 0).filter((n) => n > 0)),
  ].sort((a, b) => a - b);

  // Awarding order, fixed once: first seat left of the button. Every postflop
  // street already begins there, so `'flop'` here is standing in for "postflop"
  // rather than saying anything about the flop — this is the existing rule
  // rather than a new one.
  const order = actionOrder('flop');

  const pots: Pot[] = [];
  let floor = 0;

  for (const level of levels) {
    let amount = 0;
    for (const seat of state.seats) {
      const contributed = put.get(seat.position) ?? 0;
      amount += Math.min(contributed, level) - Math.min(contributed, floor);
    }

    if (amount > 0) {
      pots.push({
        amount: chips(amount),
        eligible: order.filter(
          (position) =>
            contesting.some((seat) => seat.position === position) &&
            (put.get(position) ?? 0) >= level,
        ),
      });
    }

    floor = level;
  }

  return pots;
}
