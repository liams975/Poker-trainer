/**
 * Where everybody sits, and what they have done.
 *
 * This exists so that the table visualisation is a projection of `HandState`
 * rather than a second reading of it. CLAUDE.md: poker logic never lives in a
 * React component — and "which seat did what" is read off `state.history`,
 * which is exactly that.
 *
 * It replaces two independent derivations that had already drifted: the seat
 * strip found its own seats and rendered `totalCommitted`, while the action
 * list filtered its own history and rendered actions. Two readings of one
 * state is how a screen ends up disagreeing with itself.
 *
 * **Action order and ring order are different things and both are returned.**
 * The array is in action order, because that is the order the hand happens in
 * and therefore the order a screen reader should walk. `ringIndex` carries the
 * geometry separately, so the component positions by index without ever
 * reordering the DOM. Phase 10's accessibility work found a `role="grid"` with
 * no rows; the lesson taken from it was that visual structure and document
 * structure have to be decided together rather than one being derived from the
 * other by accident.
 */

import type { Position } from '../ranges';
import { POSITIONS } from '../ranges';

import type { BettingAction, HandState, Seat } from './hand-state';
import { actionOrder } from './hand-state';

export interface SeatView {
  position: Position;
  seat: Seat;
  /**
   * The most recent action this seat took **on the current street**, if any.
   *
   * Scoped deliberately. Preflop aggression is spent once the flop is dealt,
   * and a seat still captioned "raised to 2.5bb" on the flop is describing
   * chips that are already in the pot behind it.
   */
  lastAction: BettingAction | undefined;
  /**
   * True when this seat's live commitment is a blind it has not yet acted on.
   *
   * The blinds are posted by `createHandState` and never enter `history`, so a
   * caller reading history alone shows the small blind as having done nothing
   * while half a big blind of its stack sits in the pot. `committed` resets
   * when a street closes, so this is false from the flop onwards without
   * needing to name the street.
   */
  postedBlind: boolean;
  isHero: boolean;
  isToAct: boolean;
  /** Clockwise from hero, who is always 0. The ring maps index to an angle. */
  ringIndex: number;
}

/**
 * The seats, in action order, each knowing where it sits relative to hero.
 *
 * Hero is `ringIndex` 0 and is drawn at the bottom of the screen, so the ring
 * walks in seating order from there: for a hero on the button that is SB, BB,
 * UTG, HJ, CO — the blinds immediately to hero's left, which is the one
 * spatial fact a horizontal strip cannot express and the reason this exists.
 *
 * Seating order and preflop action order are the same sequence, which is not a
 * coincidence: preflop action moves around the table from the seat after the
 * big blind. So the rotation is over `POSITIONS` even when the array itself is
 * ordered by a later street's action order.
 */
export function seatRing(state: HandState, hero: Position): readonly SeatView[] {
  const seated = POSITIONS.filter((position) =>
    state.seats.some((seat) => seat.position === position),
  );

  const start = seated.indexOf(hero);
  if (start === -1) {
    // Not a defaultable condition: a ring with nobody marked as hero renders a
    // table the user is not sitting at, which is worse than a thrown error.
    throw new RangeError(`no seat at ${hero} in a ${state.tableSize}-handed hand`);
  }

  const ringIndexOf = new Map<Position, number>(
    seated.map((position, index) => [
      position,
      (index - start + seated.length) % seated.length,
    ]),
  );

  return actionOrder(state.street)
    .map((position) => state.seats.find((seat) => seat.position === position))
    .filter((seat): seat is Seat => seat !== undefined)
    .map((seat) => {
      // Walked from the end: the latest entry wins, which is what makes a seat
      // that opened and then 4-bet read as the 4-bet.
      let lastAction: BettingAction | undefined;
      for (let index = state.history.length - 1; index >= 0; index--) {
        const entry = state.history[index]!;
        if (entry.street === state.street && entry.position === seat.position) {
          lastAction = entry;
          break;
        }
      }

      return {
        position: seat.position,
        seat,
        lastAction,
        postedBlind: lastAction === undefined && seat.committed > 0,
        isHero: seat.position === hero,
        isToAct: state.toAct === seat.position,
        ringIndex: ringIndexOf.get(seat.position) ?? 0,
      };
    });
}
