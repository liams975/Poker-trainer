/**
 * The state of a hand in progress.
 *
 * docs/01-architecture.md: "HandState models a full hand, not just a preflop
 * spot. Even though v1 only drills preflop decisions, model streets, pot,
 * betting history, and legal actions from the start." Widening a narrow model
 * later would touch every call site; this is the cheap moment.
 *
 * The design rule throughout: **nothing derivable is stored.** The pot, the
 * current bet, what a seat owes and the minimum raise are all computed from the
 * seats and the current street's history. A cached total that has drifted from
 * the seats is the classic state-machine bug, and deriving makes it
 * unrepresentable rather than merely unlikely.
 *
 * Chip amounts are in big blinds, rounded to two decimals to match
 * `drill_attempts.user_size numeric(6,2)`.
 */

import type { Card, Combo } from '../cards';
import { requireDistinctCards } from '../cards';
import type { Action, Position } from '../ranges';
import { POSITIONS } from '../ranges';

export const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;

export type Street = (typeof STREETS)[number];

/** Preflop the blinds act last; on every later street they act first. */
const PREFLOP_ORDER: readonly Position[] = POSITIONS;
const POSTFLOP_ORDER: readonly Position[] = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];

export function actionOrder(street: Street): readonly Position[] {
  return street === 'preflop' ? PREFLOP_ORDER : POSTFLOP_ORDER;
}

/** How many cards the board holds once a street is fully dealt. */
const BOARD_SIZE: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

export type SeatStatus = 'active' | 'folded' | 'allin';

export interface Seat {
  position: Position;
  /** Chips still behind. */
  stack: number;
  /** Chips committed on the current street; reset when a street closes. */
  committed: number;
  /** Chips committed across the whole hand. This is what feeds the pot. */
  totalCommitted: number;
  status: SeatStatus;
  /** Absent for opponents whose cards are unknown, which is the normal case. */
  hole?: Combo;
}

export interface BettingAction {
  street: Street;
  position: Position;
  action: Action;
  /** Total raised *to*, not the increment. Present for bet, raise and allin. */
  size?: number;
}

export interface HandState {
  tableSize: number;
  stackDepth: number;
  smallBlind: number;
  bigBlind: number;
  street: Street;
  seats: readonly Seat[];
  board: readonly Card[];
  /** Undefined once the hand is complete. */
  toAct: Position | undefined;
  history: readonly BettingAction[];
}

export interface HandConfig {
  tableSize?: number;
  stackDepth?: number;
  smallBlind?: number;
  bigBlind?: number;
  /** Per-seat stack overrides, for spots where someone is short. */
  stacks?: Partial<Record<Position, number>>;
  hole?: Partial<Record<Position, Combo>>;
}

/** Two decimals, matching the money column the DB stores these in. */
export function chips(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function createHandState(config: HandConfig = {}): HandState {
  const tableSize = config.tableSize ?? 6;
  const stackDepth = config.stackDepth ?? 100;
  const smallBlind = config.smallBlind ?? 0.5;
  const bigBlind = config.bigBlind ?? 1;

  if (!Number.isInteger(tableSize) || tableSize < 2 || tableSize > POSITIONS.length) {
    throw new RangeError(`tableSize must be an integer in [2, ${POSITIONS.length}], got ${tableSize}`);
  }
  if (!Number.isFinite(stackDepth) || stackDepth <= 0) {
    throw new RangeError(`stackDepth must be positive, got ${stackDepth}`);
  }
  if (!Number.isFinite(smallBlind) || smallBlind <= 0 || !(bigBlind > smallBlind)) {
    throw new RangeError(`blinds must satisfy 0 < smallBlind < bigBlind, got ${smallBlind}/${bigBlind}`);
  }

  // Short-handed tables drop the earliest positions first: 5-max is HJ..BB.
  const seated = POSITIONS.slice(POSITIONS.length - tableSize);

  const seats: Seat[] = seated.map((position) => {
    const starting = config.stacks?.[position] ?? stackDepth;
    if (!Number.isFinite(starting) || starting <= 0) {
      throw new RangeError(`${position} needs a positive stack, got ${starting}`);
    }

    const blind = position === 'SB' ? smallBlind : position === 'BB' ? bigBlind : 0;
    const committed = chips(Math.min(blind, starting));
    const hole = config.hole?.[position];

    return {
      position,
      stack: chips(starting - committed),
      committed,
      totalCommitted: committed,
      // A stack too small to cover its own blind is all-in before the deal.
      status: committed >= starting ? 'allin' : 'active',
      ...(hole ? { hole } : {}),
    };
  });

  requireDistinctCards(seats.flatMap((seat) => (seat.hole ? [...seat.hole] : [])));

  const first = seated.find((position) => seats.find((s) => s.position === position)?.status === 'active');

  return {
    tableSize,
    stackDepth,
    smallBlind,
    bigBlind,
    street: 'preflop',
    seats,
    board: [],
    toAct: first,
    history: [],
  };
}

export function seatAt(state: HandState, position: Position): Seat {
  const seat = state.seats.find((s) => s.position === position);
  if (seat === undefined) throw new RangeError(`no seat at ${position} in a ${state.tableSize}-handed hand`);
  return seat;
}

/** Seats that can still act. */
export function activeSeats(state: HandState): readonly Seat[] {
  return state.seats.filter((s) => s.status === 'active');
}

/** Seats still in the hand, including those already all-in. */
export function contestingSeats(state: HandState): readonly Seat[] {
  return state.seats.filter((s) => s.status !== 'folded');
}

export function potSize(state: HandState): number {
  return chips(state.seats.reduce((total, seat) => total + seat.totalCommitted, 0));
}

export function currentBet(state: HandState): number {
  const highest = state.seats.reduce((most, seat) => Math.max(most, seat.committed), 0);

  // Preflop there is a live bet of one big blind whether or not the seat
  // posting it could cover it. Taking the max committed alone would let a big
  // blind who is all-in for 0.56 reduce what everyone else has to call, and
  // drag the minimum raise down with it. `streetBetting` already seeds from
  // `bigBlind` for the same reason.
  return state.street === 'preflop' ? Math.max(highest, state.bigBlind) : highest;
}

export function amountToCall(state: HandState, position: Position): number {
  const seat = seatAt(state, position);
  return chips(Math.min(currentBet(state) - seat.committed, seat.stack));
}

export interface StreetBetting {
  /** The highest amount bet to on this street. */
  bet: number;
  /** The last *full* raise increment, which anchors the minimum raise. */
  increment: number;
  /** History index of that full raise, or -1 if the street has had none. */
  lastFullIndex: number;
}

/**
 * Replays the current street's aggression.
 *
 * The distinction that matters: an all-in short of a full raise moves `bet` but
 * leaves `increment` and `lastFullIndex` alone, because it is not a raise. That
 * single behaviour is what makes the minimum raise stay anchored and what stops
 * the betting reopening to players who have already acted.
 */
export function streetBetting(state: HandState): StreetBetting {
  let bet = state.street === 'preflop' ? state.bigBlind : 0;
  let increment = state.bigBlind;
  let lastFullIndex = -1;

  state.history.forEach((entry, index) => {
    if (entry.street !== state.street) return;
    if (entry.size === undefined || entry.size <= bet) return;

    const step = chips(entry.size - bet);
    if (step >= increment) {
      increment = step;
      lastFullIndex = index;
    }
    bet = entry.size;
  });

  return { bet, increment, lastFullIndex };
}

export function minRaiseTo(state: HandState): number {
  return chips(currentBet(state) + streetBetting(state).increment);
}

/**
 * Whether this seat has already had its turn since the last full raise.
 *
 * Doubles as the reopening rule: a seat that has acted since the last full
 * aggression may only call or fold when facing a short all-in. Note the `>=`:
 * the raiser's own action *is* at `lastFullIndex`, so a player facing a short
 * shove after their own raise cannot re-raise either.
 */
export function hasActedSinceLastAggression(state: HandState, position: Position): boolean {
  const { lastFullIndex } = streetBetting(state);

  return state.history.some(
    (entry, index) =>
      index >= lastFullIndex && entry.street === state.street && entry.position === position,
  );
}

/** Adds the cards a street reveals. Betting never deals; callers supply them. */
export function dealBoard(state: HandState, cards: readonly Card[]): HandState {
  const needed = BOARD_SIZE[state.street] - state.board.length;

  if (needed <= 0) {
    throw new RangeError(`the ${state.street} board is already complete`);
  }
  if (cards.length !== needed) {
    throw new RangeError(`the ${state.street} needs ${needed} card(s), got ${cards.length}`);
  }

  const known: Card[] = [...state.board, ...cards];
  for (const seat of state.seats) if (seat.hole) known.push(...seat.hole);
  requireDistinctCards(known);

  return { ...state, board: [...state.board, ...cards] };
}
