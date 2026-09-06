import { describe, expect, it } from 'vitest';

import { formatCards } from '../src/cards';
import type { Card } from '../src/cards';
import { applyAction, dealHand, dealStreet } from '../src/game';
import { mulberry32 } from '../src/rng';

/**
 * Dealing.
 *
 * `dealBoard` has existed since Phase 3 but takes the cards it is given —
 * nothing in the engine has ever produced them, because a drill spot is
 * constructed from a scenario rather than dealt. A bot hand has to deal.
 *
 * The property that matters more than any other here is **determinism**. Every
 * source of randomness in this codebase is seeded and injected (CLAUDE.md), and
 * for bot play that buys the thing 12b needs most: a hand can be replayed
 * exactly from its seed, so a hand history is a seed and a list of actions
 * rather than a transcript of fifty-two cards.
 */

const seated = (n: number) => ({ tableSize: n });

describe('dealHand', () => {
  it('gives every seat two cards and nobody the same card twice', () => {
    const { state, deck } = dealHand(mulberry32(1), seated(6));

    const dealt: Card[] = [];
    for (const seat of state.seats) {
      expect(seat.hole, `${seat.position} has no cards`).toBeDefined();
      dealt.push(seat.hole![0], seat.hole![1]);
    }

    expect(dealt).toHaveLength(12);
    expect(new Set(dealt).size, 'a card was dealt twice').toBe(12);
    expect(deck).toHaveLength(52 - 12);
    expect(new Set([...dealt, ...deck]).size, 'the deck overlaps the hole cards').toBe(52);
  });

  it('deals the same cards for the same seed', () => {
    const one = dealHand(mulberry32(99), seated(6));
    const two = dealHand(mulberry32(99), seated(6));

    expect(one.state.seats.map((s) => formatCards(s.hole!))).toEqual(
      two.state.seats.map((s) => formatCards(s.hole!)),
    );
    expect(formatCards(one.deck)).toBe(formatCards(two.deck));
  });

  it('deals differently for different seeds', () => {
    const one = dealHand(mulberry32(1), seated(6));
    const two = dealHand(mulberry32(2), seated(6));

    expect(formatCards(one.deck)).not.toBe(formatCards(two.deck));
  });

  it('deals only to the seats that exist', () => {
    const { state, deck } = dealHand(mulberry32(7), seated(3));

    expect(state.seats).toHaveLength(3);
    expect(deck).toHaveLength(52 - 6);
  });

  it('passes the rest of the hand config through', () => {
    const { state } = dealHand(mulberry32(3), { stacks: { BTN: 20 } });

    expect(state.seats.find((seat) => seat.position === 'BTN')!.stack).toBe(20);
    expect(state.seats.find((seat) => seat.position === 'CO')!.stack).toBe(100);
    // The blinds are still posted by `createHandState`, not re-implemented here.
    expect(state.seats.find((seat) => seat.position === 'SB')!.committed).toBe(0.5);
  });
});

describe('dealStreet', () => {
  /** Folds round to the blinds, then the small blind calls: preflop closes. */
  function toFlop() {
    const dealt = dealHand(mulberry32(11), seated(6));
    let state = dealt.state;
    for (let i = 0; i < 3; i++) state = applyAction(state, 'fold'); // UTG, HJ, CO
    state = applyAction(state, 'fold'); // BTN
    state = applyAction(state, 'call'); // SB
    state = applyAction(state, 'check'); // BB
    return { state, deck: dealt.deck };
  }

  it('turns three cards for the flop, then one each street', () => {
    let { state, deck } = toFlop();
    expect(state.street).toBe('flop');

    ({ state, deck } = dealStreet(state, deck));
    expect(state.board).toHaveLength(3);
    expect(deck).toHaveLength(52 - 12 - 3);

    state = applyAction(state, 'check');
    state = applyAction(state, 'check');
    expect(state.street).toBe('turn');

    ({ state, deck } = dealStreet(state, deck));
    expect(state.board).toHaveLength(4);

    state = applyAction(state, 'check');
    state = applyAction(state, 'check');
    ({ state, deck } = dealStreet(state, deck));
    expect(state.board).toHaveLength(5);
    expect(deck).toHaveLength(52 - 12 - 5);
  });

  it('never deals a board card somebody is holding', () => {
    const { state: flopped, deck } = toFlop();
    const { state } = dealStreet(flopped, deck);

    const holes = state.seats.flatMap((seat) => (seat.hole ? [...seat.hole] : []));
    for (const card of state.board) {
      expect(holes, `${formatCards([card])} is on the board and in a hand`).not.toContain(card);
    }
  });

  it('refuses to deal a board to a street that does not want one', () => {
    const { state, deck } = dealHand(mulberry32(5), seated(6));

    expect(state.street).toBe('preflop');
    expect(() => dealStreet(state, deck)).toThrow(/preflop/);
  });

  it('refuses when the deck is too short to finish the street', () => {
    const { state } = toFlop();

    expect(() => dealStreet(state, [])).toThrow(/deck/i);
  });
});
