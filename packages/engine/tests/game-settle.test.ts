import { describe, expect, it } from 'vitest';

import { parseCards } from '../src/cards';
import type { Card, Combo } from '../src/cards';
import { applyAction, createHandState, settleHand } from '../src/game';
import type { HandState, Seat, SeatStatus } from '../src/game';
import type { Position } from '../src/ranges';

/**
 * Awarding the pots `buildPots` built.
 *
 * The other half of Phase 3's documented omission. `pot.ts` decides how much is
 * in each layer and who may win it; this decides who did, and moves the chips.
 *
 * Two rules get their own tests because both are silent when wrong:
 *
 *   - **Odd chips go to the first seat left of the button.** Amounts are two
 *     decimal places, so a three-way split of an odd pot leaves a remainder
 *     that has to land somewhere, and "wherever the winners array happened to
 *     be ordered" is not a rule.
 *   - **A folded-out pot has no showdown.** Nobody's cards are ranked and
 *     nobody's cards are revealed, which 12b needs to know.
 */

function combo(text: string): Combo {
  const [a, b] = parseCards(text);
  return [a!, b!];
}

function stateWith(
  seats: readonly { at: Position; put: number; stack?: number; status?: SeatStatus; hole?: string }[],
  board: string,
): HandState {
  return {
    tableSize: 6,
    stackDepth: 100,
    smallBlind: 0.5,
    bigBlind: 1,
    street: 'river',
    seats: seats.map(
      ({ at, put, stack = 0, status = 'active', hole }): Seat => ({
        position: at,
        stack,
        committed: 0,
        totalCommitted: put,
        status,
        ...(hole ? { hole: combo(hole) } : {}),
      }),
    ),
    board: board === '' ? [] : (parseCards(board) as Card[]),
    toAct: undefined,
    history: [],
  };
}

/** Chips on the table before and after must match, always. */
function expectConserved(before: HandState, after: HandState): void {
  const chipsIn = (state: HandState, includeCommitted: boolean) =>
    state.seats.reduce(
      (sum, seat) => sum + seat.stack + (includeCommitted ? seat.totalCommitted : 0),
      0,
    );

  expect(chipsIn(after, false), 'chips were created or destroyed by settling').toBeCloseTo(
    chipsIn(before, true),
    10,
  );
}

const payoutFor = (result: { payouts: readonly { position: Position; won: number; net: number }[] }, at: Position) =>
  result.payouts.find((payout) => payout.position === at)!;

describe('settleHand — a showdown', () => {
  it('pays the best hand the whole pot', () => {
    // BTN has a set of kings; BB has two pair.
    const before = stateWith(
      [
        { at: 'BTN', put: 20, hole: 'Kh Kd' },
        { at: 'BB', put: 20, hole: 'Ah Qs' },
      ],
      'Ks Ac Qh 7d 2c',
    );

    const { state, result } = settleHand(before);

    expect(payoutFor(result, 'BTN').won).toBe(40);
    expect(payoutFor(result, 'BTN').net).toBe(20);
    expect(payoutFor(result, 'BB').won).toBe(0);
    expect(payoutFor(result, 'BB').net).toBe(-20);
    expect(result.showdown, 'a contested pot must rank hands').toBeDefined();
    expectConserved(before, state);
  });

  it('splits an exact tie evenly', () => {
    // The board plays: both have ace-king kickers on a broadway board.
    const before = stateWith(
      [
        { at: 'BTN', put: 15, hole: '2h 3d' },
        { at: 'BB', put: 15, hole: '2s 3c' },
      ],
      'As Kd Qh Jc Ts',
    );

    const { state, result } = settleHand(before);

    expect(payoutFor(result, 'BTN').won).toBe(15);
    expect(payoutFor(result, 'BB').won).toBe(15);
    expect(result.pots[0]!.winners).toHaveLength(2);
    expectConserved(before, state);
  });

  it('gives odd chips to the earliest seats left of the button', () => {
    /**
     * A three-way chop of 30.50 — three live seats in for 10 each, plus a small
     * blind who folded and left 0.50 behind. In cents: 3050 over three ways is
     * 1016 each with 2 left, so the first two eligible seats take a cent more.
     *
     * The dead money is what makes the pot indivisible, and it has to be. Three
     * equal contributions always divide by three; an *unequal* top contribution
     * is an uncalled bet and comes back before any pot is built. A folded
     * seat's chips are the only way an evenly-contested pot ends up odd, which
     * is worth knowing before writing a rule about odd chips.
     */
    const before = stateWith(
      [
        { at: 'SB', put: 0.5, status: 'folded' },
        { at: 'BB', put: 10, hole: '2s 3c' },
        { at: 'CO', put: 10, hole: '2d 3h' },
        { at: 'BTN', put: 10, hole: '2h 4d' },
      ],
      'As Kd Qh Jc Ts',
    );

    const { state, result } = settleHand(before);

    // Postflop order is SB, BB, UTG, HJ, CO, BTN — so BB and CO are earliest.
    expect(payoutFor(result, 'BB').won).toBe(10.17);
    expect(payoutFor(result, 'CO').won).toBe(10.17);
    expect(payoutFor(result, 'BTN').won, 'the last seat takes the short share').toBe(10.16);
    expect(result.pots[0]!.amount).toBe(30.5);
    expectConserved(before, state);
  });

  it('pays the main pot and the side pot to different players', () => {
    /**
     * The case side pots exist for. CO is all-in for 20 with the best hand and
     * can only win what he covered; BTN takes the 60 above it.
     */
    const before = stateWith(
      [
        { at: 'CO', put: 20, status: 'allin', hole: 'Ah Ad' },
        { at: 'BTN', put: 50, hole: 'Kh Kd' },
        { at: 'BB', put: 50, hole: '7h 8d' },
      ],
      'As Kc 2h 5d 9c',
    );

    const { state, result } = settleHand(before);

    expect(result.pots).toHaveLength(2);
    expect(result.pots[0]!.winners, 'the short stack wins the main pot').toEqual(['CO']);
    expect(result.pots[1]!.winners, 'the side pot is between the two who covered').toEqual(['BTN']);
    expect(payoutFor(result, 'CO').won).toBe(60);
    expect(payoutFor(result, 'BTN').won).toBe(60);
    expect(payoutFor(result, 'BB').won).toBe(0);
    expectConserved(before, state);
  });

  it('never pays a folded seat, however good its cards were', () => {
    const before = stateWith(
      [
        { at: 'UTG', put: 20, status: 'folded', hole: 'Ah Ad' },
        { at: 'BTN', put: 20, hole: '7h 8d' },
        { at: 'BB', put: 20, hole: '2c 3s' },
      ],
      'Ac As 9h 5d 4c',
    );

    const { result } = settleHand(before);

    expect(payoutFor(result, 'UTG').won).toBe(0);
    expect(result.showdown?.some((entry) => entry.position === 'UTG')).toBe(false);
  });
});

describe('settleHand — no showdown', () => {
  it('awards the pot without ranking anything when everyone folded', () => {
    const before = stateWith(
      [
        { at: 'UTG', put: 12, status: 'folded' },
        { at: 'BTN', put: 12 },
      ],
      '',
    );

    const { state, result } = settleHand(before);

    expect(result.showdown, 'nothing should be ranked in a folded-out pot').toBeUndefined();
    expect(payoutFor(result, 'BTN').won).toBe(24);
    expectConserved(before, state);
  });

  it('does not need hole cards or a board to end a folded-out hand', () => {
    // The realistic case: everyone folds on the flop, so there are two cards
    // still to come and nobody's cards were ever dealt face up.
    const before = stateWith(
      [
        { at: 'UTG', put: 8, status: 'folded' },
        { at: 'BB', put: 8 },
      ],
      'Ks 7h 2d',
    );

    expect(() => settleHand(before)).not.toThrow();
  });

  it('returns an uncalled shove before awarding', () => {
    const before = stateWith(
      [
        { at: 'CO', put: 12, status: 'folded' },
        { at: 'BTN', put: 50, stack: 0 },
      ],
      '',
    );

    const { state, result } = settleHand(before);

    expect(result.uncalled).toEqual({ position: 'BTN', amount: 38 });
    // 38 back, plus the 24 pot.
    expect(payoutFor(result, 'BTN').won).toBe(62);
    expect(payoutFor(result, 'BTN').net).toBe(12);
    expectConserved(before, state);
  });
});

describe('settleHand — refusals', () => {
  it('refuses a contested pot on an incomplete board', () => {
    // Two live seats and four cards. Ranking here would compare six-card hands
    // and quietly return a winner for a hand that is not over.
    const before = stateWith(
      [
        { at: 'BTN', put: 20, hole: 'Kh Kd' },
        { at: 'BB', put: 20, hole: 'Ah Qs' },
      ],
      'Ks Ac Qh 7d',
    );

    expect(() => settleHand(before)).toThrow(/board/i);
  });

  it('refuses a contested pot where a live seat has no cards', () => {
    const before = stateWith(
      [
        { at: 'BTN', put: 20, hole: 'Kh Kd' },
        { at: 'BB', put: 20 },
      ],
      'Ks Ac Qh 7d 2c',
    );

    expect(() => settleHand(before)).toThrow(/BB/);
  });

  it('refuses a hand that is not over', () => {
    const before = createHandState();

    expect(before.toAct).toBeDefined();
    expect(() => settleHand(before)).toThrow(/complete|over|acting/i);
  });
});

describe('settleHand — against a hand actually played', () => {
  it('gives the blinds to an uncontested open', () => {
    let state = createHandState();
    state = applyAction(state, 'raise', 3);
    for (let i = 0; i < 5; i++) state = applyAction(state, 'fold');

    const { state: settled, result } = settleHand(state);

    // Won 1.5 of other people's money; 2 of the 3 came straight back.
    expect(payoutFor(result, 'UTG').net).toBe(1.5);
    expect(payoutFor(result, 'SB').net).toBe(-0.5);
    expect(payoutFor(result, 'BB').net).toBe(-1);
    expect(settled.seats.find((seat) => seat.position === 'UTG')!.stack).toBe(101.5);
    expectConserved(state, settled);
  });
});
