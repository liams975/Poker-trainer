/**
 * The betting rules: what is legal, and what applying it produces.
 *
 * v1 only ever drills preflop, but these are the rules a v2 bot will play by,
 * and a bot that raises illegally is a bug discovered in production. So the
 * rules are complete for every street, with two deliberate omissions recorded
 * in the plan: side pots are not split, and no showdown is awarded. Seats
 * already carry `totalCommitted`, so adding both later is additive.
 */

import type { Action, Position } from '../ranges';

import type { BettingAction, HandState, Seat, SeatStatus, Street } from './hand-state';
import {
  STREETS,
  actionOrder,
  activeSeats,
  amountToCall,
  chips,
  contestingSeats,
  currentBet,
  hasActedSinceLastAggression,
  minRaiseTo,
  seatAt,
} from './hand-state';

const EPSILON = 1e-9;

export interface LegalAction {
  action: Action;
  /** Smallest legal total to put in. Present only for `bet` and `raise`. */
  minTo?: number;
  /** Largest, which is always the whole stack. */
  maxTo?: number;
}

export function isHandComplete(state: HandState): boolean {
  return state.toAct === undefined;
}

export function legalActions(state: HandState): readonly LegalAction[] {
  if (state.toAct === undefined) return [];

  const position = state.toAct;
  const seat = seatAt(state, position);
  if (seat.status !== 'active') return [];

  const bet = currentBet(state);
  const toCall = amountToCall(state, position);
  const maxTo = chips(seat.committed + seat.stack);
  // The reopening rule. A seat that has acted since the last full raise may
  // call or fold, but may not raise into a short all-in.
  const mayAggress = !hasActedSinceLastAggression(state, position);

  const actions: LegalAction[] = [];

  if (toCall > EPSILON) {
    actions.push({ action: 'fold' });
    actions.push({ action: 'call' });
  } else {
    // No fold when checking is free: it is strictly dominated, and no chart
    // ever prescribes it.
    actions.push({ action: 'check' });
  }

  if (bet <= EPSILON) {
    // Preflop never reaches here — the big blind is already a live bet.
    if (mayAggress && seat.stack >= state.bigBlind - EPSILON) {
      actions.push({ action: 'bet', minTo: state.bigBlind, maxTo });
    }
  } else if (mayAggress) {
    const min = minRaiseTo(state);
    if (maxTo >= min - EPSILON) actions.push({ action: 'raise', minTo: min, maxTo });
  }

  // All-in is offered only as aggression. A stack too short to cover the call
  // is handled by `call`, capped — two names for one physical act would be a
  // grading hazard once `drill_attempts.user_action` records it.
  if (mayAggress && seat.stack > EPSILON && maxTo > bet + EPSILON) {
    actions.push({ action: 'allin' });
  }

  return actions;
}

export function applyAction(state: HandState, action: Action, size?: number): HandState {
  if (state.toAct === undefined) {
    throw new RangeError('the hand is complete; there is nobody to act');
  }

  const position = state.toAct;
  const legal = legalActions(state);
  const match = legal.find((candidate) => candidate.action === action);

  if (match === undefined) {
    const offered = legal.map((c) => c.action).join(', ') || 'nothing';
    throw new RangeError(`${action} is not legal for ${position}; legal actions are ${offered}`);
  }

  const sized = match.minTo !== undefined;
  if (sized && size === undefined) {
    throw new RangeError(`${action} needs a size, in big blinds`);
  }
  if (!sized && size !== undefined) {
    throw new RangeError(`${action} does not take a size`);
  }
  if (sized && size !== undefined) {
    if (!Number.isFinite(size) || size < match.minTo! - EPSILON || size > match.maxTo! + EPSILON) {
      throw new RangeError(
        `${action} to ${size} is outside the legal range [${match.minTo}, ${match.maxTo}]`,
      );
    }
  }

  const seat = seatAt(state, position);
  let put = 0;
  let status: SeatStatus = seat.status;
  let recorded: number | undefined;
  let recordedAction: Action = action;

  switch (action) {
    case 'fold':
      status = 'folded';
      break;
    case 'check':
      break;
    case 'call':
      put = amountToCall(state, position);
      break;
    case 'bet':
    case 'raise':
      put = chips(size! - seat.committed);
      recorded = chips(size!);
      break;
    case 'allin':
      put = seat.stack;
      recorded = chips(seat.committed + seat.stack);
      break;
  }

  if (put > EPSILON && put >= seat.stack - EPSILON) {
    status = 'allin';
    // Canonical name. A raise that commits the whole stack *is* an all-in, and
    // `drill_attempts.user_action` must not record the same physical act under
    // two names — Phase 3b grades against that column.
    if (action === 'bet' || action === 'raise') recordedAction = 'allin';
  }

  const seats: Seat[] = state.seats.map((current) =>
    current.position === position
      ? {
          ...current,
          stack: chips(current.stack - put),
          committed: chips(current.committed + put),
          totalCommitted: chips(current.totalCommitted + put),
          status,
        }
      : current,
  );

  const entry: BettingAction = {
    street: state.street,
    position,
    action: recordedAction,
    ...(recorded !== undefined ? { size: recorded } : {}),
  };

  return settle({ ...state, seats, history: [...state.history, entry] }, position);
}

function seatedOrder(state: HandState, street: Street): readonly Position[] {
  return actionOrder(street).filter((position) =>
    state.seats.some((seat) => seat.position === position),
  );
}

function nextActive(state: HandState, after: Position): Position | undefined {
  const order = seatedOrder(state, state.street);
  const start = order.indexOf(after);

  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(start + step) % order.length]!;
    if (seatAt(state, candidate).status === 'active') return candidate;
  }

  return undefined;
}

function firstActive(state: HandState): Position | undefined {
  return seatedOrder(state, state.street).find(
    (position) => seatAt(state, position).status === 'active',
  );
}

/**
 * A street closes when every seat that can still act has matched the current
 * bet *and* has had a turn since the last full raise.
 *
 * The second half is what preserves the big blind's option: preflop the BB has
 * matched the bet by posting, but has never acted, so the round stays open.
 */
function isRoundClosed(state: HandState): boolean {
  const active = activeSeats(state);
  if (active.length === 0) return true;

  const bet = currentBet(state);

  return active.every(
    (seat) =>
      Math.abs(seat.committed - bet) < EPSILON &&
      hasActedSinceLastAggression(state, seat.position),
  );
}

function advance(state: HandState): HandState {
  let current = state;

  for (;;) {
    if (contestingSeats(current).length <= 1) return { ...current, toAct: undefined };

    const index = STREETS.indexOf(current.street);
    if (index === STREETS.length - 1) return { ...current, toAct: undefined };

    current = {
      ...current,
      street: STREETS[index + 1]!,
      seats: current.seats.map((seat) => ({ ...seat, committed: 0 })),
    };

    // With fewer than two seats able to act there is no betting left; the
    // remaining streets run out and the hand ends.
    if (activeSeats(current).length > 1) {
      const first = firstActive(current);
      if (first !== undefined) return { ...current, toAct: first };
    }
  }
}

function settle(state: HandState, actor: Position): HandState {
  if (contestingSeats(state).length <= 1) return { ...state, toAct: undefined };
  if (isRoundClosed(state)) return advance(state);

  const next = nextActive(state, actor);
  return next === undefined ? advance(state) : { ...state, toAct: next };
}
