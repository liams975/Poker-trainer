/**
 * Dealing a hand.
 *
 * `dealBoard` has taken its cards from the caller since Phase 3, because a
 * drill spot is *constructed* from a scenario rather than dealt — `rebuildSpot`
 * needs the same cards every time and gets them from the stored seed. A bot
 * hand is the first thing in the codebase that actually deals.
 *
 * Everything comes off one shuffled deck in order, and the shuffle is the
 * seeded `shuffle` from `rng`. So a hand is reproducible from its seed alone,
 * which is what lets 12b store a hand history as a seed plus a list of actions
 * rather than a transcript of fifty-two cards — and what lets the simulation in
 * this phase re-run a failure exactly.
 */

import type { Card, Combo } from '../cards';
import { FULL_DECK } from '../cards';
import type { Position } from '../ranges';
import type { Rng } from '../rng';
import { shuffle } from '../rng';

import type { HandConfig, HandState } from './hand-state';
import { boardCardsNeeded, createHandState, dealBoard } from './hand-state';

export interface Dealt {
  state: HandState;
  /** The undealt remainder, in order. Board cards come off the front. */
  deck: readonly Card[];
}

/** How many seats a table of this size has, in the order they are dealt to. */
function seatedPositions(config: HandConfig): number {
  return config.tableSize ?? 6;
}

/**
 * Shuffles, deals two cards to every seat, and posts the blinds.
 *
 * The blinds are posted by `createHandState`, not re-implemented here — this
 * only decides which cards go where. Hole cards are dealt in the order
 * `createHandState` seats people, which is not how a real dealer goes round the
 * table one card at a time; with a fair shuffle the distribution is identical
 * and the bookkeeping is much simpler to verify.
 */
export function dealHand(rng: Rng, config: HandConfig = {}): Dealt {
  const deck = shuffle(rng, FULL_DECK);

  // Built first, so `createHandState`'s own validation of table size and stacks
  // runs before any card is assigned to a seat that may not exist.
  const empty = createHandState(config);

  const hole: Partial<Record<Position, Combo>> = {};
  let next = 0;

  for (const seat of empty.seats) {
    hole[seat.position] = [deck[next]!, deck[next + 1]!];
    next += 2;
  }

  return {
    state: createHandState({ ...config, tableSize: seatedPositions(config), hole }),
    deck: deck.slice(next),
  };
}

/**
 * Deals whatever the current street still needs off the front of the deck.
 *
 * `dealBoard` does the work and re-checks that no board card is already in
 * somebody's hand — which cannot happen with one deck dealt in order, and is
 * checked anyway because the cost is nothing and the failure would be a hand
 * that silently contains five aces.
 */
export function dealStreet(state: HandState, deck: readonly Card[]): Dealt {
  const needed = boardCardsNeeded(state);

  if (needed <= 0) {
    throw new RangeError(`the ${state.street} board needs no cards`);
  }
  if (deck.length < needed) {
    throw new RangeError(
      `the deck has ${deck.length} card(s) left and the ${state.street} needs ${needed}`,
    );
  }

  return {
    state: dealBoard(state, deck.slice(0, needed)),
    deck: deck.slice(needed),
  };
}
