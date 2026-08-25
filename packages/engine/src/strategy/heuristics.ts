/**
 * Postflop primitives.
 *
 * docs/02-roadmap.md asks Phase 3 for "postflop heuristic stubs: board texture
 * classification, SPR, pot odds", and that is exactly what this is — measurements,
 * not decisions. Nothing here recommends an action.
 *
 * Deliberately no `HeuristicStrategy` ships alongside them. A crude postflop
 * strategy would be able to *grade* a user, and grading someone against
 * invented postflop logic teaches wrong play. `StrategySource` keeps
 * `'heuristic'` in its union so the seam exists when real logic arrives.
 */

import type { Card, Rank } from '../cards';
import { rankOf, suitOf } from '../cards';
import type { HandState } from '../game';
import { amountToCall, contestingSeats, potSize, seatAt } from '../game';
import type { Position } from '../ranges';

export interface BoardTexture {
  /** Some rank appears more than once. */
  paired: boolean;
  /** Some rank appears three or more times. */
  trips: boolean;
  /** Every card shares one suit. */
  monotone: boolean;
  /** Exactly two suits present. */
  twoTone: boolean;
  /** Every card a different suit. */
  rainbow: boolean;
  /** Three distinct ranks sit inside a five-rank window, so a straight is live. */
  connected: boolean;
  highCard: Rank;
}

const STRAIGHT_WINDOW = 5;

export function classifyBoard(board: readonly Card[]): BoardTexture {
  if (board.length < 3 || board.length > 5) {
    throw new RangeError(`a board has 3 to 5 cards, got ${board.length}`);
  }

  const rankCounts = new Map<Rank, number>();
  const suits = new Set<number>();

  for (const card of board) {
    const rank = rankOf(card);
    rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
    suits.add(suitOf(card));
  }

  const counts = [...rankCounts.values()];
  const ranks = [...rankCounts.keys()].sort((a, b) => a - b);

  // The ace plays low for connectedness: A 2 3 is one card off a straight in
  // exactly the way 9 8 7 is.
  const withLowAce = ranks.includes(12) ? [-1, ...ranks] : ranks;
  let connected = false;
  for (let i = 0; i + 2 < withLowAce.length; i++) {
    if (withLowAce[i + 2]! - withLowAce[i]! < STRAIGHT_WINDOW) {
      connected = true;
      break;
    }
  }

  return {
    paired: counts.some((n) => n >= 2),
    trips: counts.some((n) => n >= 3),
    monotone: suits.size === 1,
    twoTone: suits.size === 2,
    rainbow: suits.size === board.length,
    connected,
    highCard: ranks[ranks.length - 1]!,
  };
}

/**
 * Both measurements are meaningless for a seat that has folded — pot odds for a
 * player with no decision left, an effective stack against nobody. Refusing is
 * better than returning a number a caller might display.
 */
function requireContesting(state: HandState, hero: Position): void {
  if (seatAt(state, hero).status === 'folded') {
    throw new RangeError(`${hero} has folded and has no stake in this pot`);
  }
}

export interface PotOdds {
  toCall: number;
  pot: number;
  /** The share of the final pot a call must win to break even. */
  requiredEquity: number;
}

export function potOdds(state: HandState, hero: Position): PotOdds {
  requireContesting(state, hero);
  const toCall = amountToCall(state, hero);
  const pot = potSize(state);

  return {
    toCall,
    pot,
    requiredEquity: toCall === 0 ? 0 : toCall / (pot + toCall),
  };
}

/**
 * Stack-to-pot ratio against the effective stack — the shorter of hero's stack
 * and the deepest opponent still in the hand, since nobody can win more than
 * the shorter stack.
 */
export function spr(state: HandState, hero: Position): number {
  requireContesting(state, hero);
  const heroSeat = seatAt(state, hero);
  const opponents = contestingSeats(state).filter((seat) => seat.position !== hero);

  if (opponents.length === 0) return 0;

  const deepestOpponent = opponents.reduce((most, seat) => Math.max(most, seat.stack), 0);
  const effective = Math.min(heroSeat.stack, deepestOpponent);
  const pot = potSize(state);

  return pot === 0 ? 0 : effective / pot;
}
