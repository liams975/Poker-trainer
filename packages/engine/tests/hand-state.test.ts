import { describe, expect, it } from 'vitest';

import { parseCards } from '../src/cards';
import type { Combo } from '../src/cards';
import {
  STREETS,
  actionOrder,
  activeSeats,
  amountToCall,
  applyAction,
  contestingSeats,
  createHandState,
  currentBet,
  dealBoard,
  minRaiseTo,
  potSize,
  seatAt,
} from '../src/game';
import { POSITIONS } from '../src/ranges';
import { legalActions } from '../src/game';
import { mulberry32 } from '../src/rng';

/**
 * docs/01-architecture.md: "HandState models a full hand, not just a preflop
 * spot. Even though v1 only drills preflop decisions, model streets, pot,
 * betting history, and legal actions from the start."
 *
 * The design rule this file pins: nothing derivable is stored. `potSize`,
 * `currentBet`, `amountToCall` and `minRaiseTo` are all computed from the
 * seats and the current street's history, so a cached total that disagrees
 * with the seats — the classic state-machine bug — is unrepresentable.
 */

function combo(text: string): Combo {
  const [a, b] = parseCards(text);
  return [a!, b!];
}

describe('createHandState', () => {
  const state = createHandState();

  it('seats six players in position order', () => {
    expect(state.seats.map((s) => s.position)).toEqual([...POSITIONS]);
    expect(state.tableSize).toBe(6);
  });

  it('starts everyone at the configured stack depth', () => {
    expect(state.stackDepth).toBe(100);
    expect(seatAt(state, 'UTG').stack).toBe(100);
    expect(seatAt(state, 'CO').stack).toBe(100);
  });

  it('posts the blinds as real commitments', () => {
    // Not bookkeeping: the big blind is already a live bet, which is why there
    // is no `bet` action preflop and why the BB gets an option.
    expect(seatAt(state, 'SB').committed).toBe(0.5);
    expect(seatAt(state, 'SB').stack).toBe(99.5);
    expect(seatAt(state, 'BB').committed).toBe(1);
    expect(seatAt(state, 'BB').stack).toBe(99);
    expect(seatAt(state, 'UTG').committed).toBe(0);
  });

  it('opens the action on UTG', () => {
    expect(state.toAct).toBe('UTG');
    expect(state.street).toBe('preflop');
    expect(state.history).toEqual([]);
  });

  it('derives the pot from the blinds', () => {
    expect(potSize(state)).toBe(1.5);
  });

  it('derives the current bet and what UTG owes', () => {
    expect(currentBet(state)).toBe(1);
    expect(amountToCall(state, 'UTG')).toBe(1);
    expect(amountToCall(state, 'SB')).toBe(0.5);
    expect(amountToCall(state, 'BB')).toBe(0);
  });

  it('opens the minimum raise at two big blinds', () => {
    expect(minRaiseTo(state)).toBe(2);
  });

  it('marks everyone active', () => {
    expect(activeSeats(state)).toHaveLength(6);
    expect(contestingSeats(state)).toHaveLength(6);
  });

  it('accepts hole cards for known seats only', () => {
    const withHero = createHandState({ hole: { UTG: combo('AsKs') } });

    expect(seatAt(withHero, 'UTG').hole).toEqual(combo('AsKs'));
    expect(seatAt(withHero, 'CO').hole).toBeUndefined();
  });

  it('accepts a shallower stack and larger blinds', () => {
    const short = createHandState({ stackDepth: 20, smallBlind: 1, bigBlind: 2 });

    expect(seatAt(short, 'BB').stack).toBe(18);
    expect(currentBet(short)).toBe(2);
    expect(minRaiseTo(short)).toBe(4);
    expect(potSize(short)).toBe(3);
  });

  it('puts a player all-in when their stack cannot cover the blind', () => {
    const tiny = createHandState({ stackDepth: 0.75 });

    expect(seatAt(tiny, 'BB').committed).toBe(0.75);
    expect(seatAt(tiny, 'BB').stack).toBe(0);
    expect(seatAt(tiny, 'BB').status).toBe('allin');
  });

  it.each([0, -1, 1.5])('rejects a table size of %s', (tableSize) => {
    expect(() => createHandState({ tableSize })).toThrow(RangeError);
  });

  it('rejects a big blind that is not larger than the small blind', () => {
    expect(() => createHandState({ smallBlind: 2, bigBlind: 1 })).toThrow(RangeError);
  });

  it('rejects duplicate hole cards across seats', () => {
    expect(() =>
      createHandState({ hole: { UTG: combo('AsKs'), CO: combo('AsQs') } }),
    ).toThrow();
  });
});

describe('action order', () => {
  it('runs UTG first preflop and SB first afterwards', () => {
    expect([...actionOrder('preflop')]).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);

    for (const street of ['flop', 'turn', 'river'] as const) {
      expect([...actionOrder(street)]).toEqual(['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN']);
    }
  });

  it('covers all four streets', () => {
    expect([...STREETS]).toEqual(['preflop', 'flop', 'turn', 'river']);
  });
});

describe('dealBoard', () => {
  function toFlop() {
    // Fold to the big blind's option, then check it through.
    let state = createHandState();
    for (const position of ['UTG', 'HJ', 'CO', 'BTN'] as const) {
      // Asserting the turn as we go: the fold order is the action order.
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }
    state = applyAction(state, 'call');
    return applyAction(state, 'check');
  }

  it('adds three cards on the flop', () => {
    const flop = dealBoard(toFlop(), parseCards('AsKd7h'));

    expect(flop.board).toHaveLength(3);
    expect(flop.street).toBe('flop');
  });

  it.each([2, 4])('rejects a flop of %i cards', (count) => {
    const cards = parseCards('AsKd7h2c').slice(0, count);

    expect(() => dealBoard(toFlop(), cards)).toThrow(RangeError);
  });

  it('rejects a card already in a seat', () => {
    let state = createHandState({ hole: { BB: combo('AsKs') } });
    for (const position of ['UTG', 'HJ', 'CO', 'BTN'] as const) {
      // Asserting the turn as we go: the fold order is the action order.
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }
    state = applyAction(state, 'call');
    state = applyAction(state, 'check');

    expect(() => dealBoard(state, parseCards('AsKd7h'))).toThrow();
  });
});

describe('the derived-state invariant', () => {
  it('keeps the pot equal to what the seats have committed, always', () => {
    // The whole reason nothing derivable is stored. Walked over a long, mixed
    // sequence rather than a single action.
    let state = createHandState();
    const check = () => {
      const committed = state.seats.reduce((sum, s) => sum + s.totalCommitted, 0);
      expect(potSize(state)).toBeCloseTo(committed, 10);
      for (const seat of state.seats) {
        expect(seat.stack).toBeGreaterThanOrEqual(0);
        expect(seat.stack + seat.totalCommitted).toBeCloseTo(state.stackDepth, 10);
      }
    };

    check();
    state = applyAction(state, 'raise', 3);   // UTG opens
    check();
    state = applyAction(state, 'fold');       // HJ
    check();
    state = applyAction(state, 'raise', 10);  // CO three-bets
    check();
    state = applyAction(state, 'fold');       // BTN
    check();
    state = applyAction(state, 'fold');       // SB
    check();
    state = applyAction(state, 'fold');       // BB
    check();
    state = applyAction(state, 'call');       // UTG calls, closing preflop
    check();

    expect(state.street).toBe('flop');
    expect(potSize(state)).toBeCloseTo(21.5, 10);

    state = applyAction(state, 'check');      // UTG
    check();
    state = applyAction(state, 'check');      // CO, closing the flop
    check();

    expect(state.street).toBe('turn');
    expect(potSize(state)).toBeCloseTo(21.5, 10);
  });

  it('never lets a seat commit more than its stack', () => {
    let state = createHandState({ stackDepth: 8 });
    state = applyAction(state, 'allin');

    expect(seatAt(state, 'UTG').totalCommitted).toBe(8);
    expect(seatAt(state, 'UTG').stack).toBe(0);
    expect(seatAt(state, 'UTG').status).toBe('allin');
  });

  it('does not mutate the state it was given', () => {
    const before = createHandState();
    const snapshot = JSON.stringify(before);

    applyAction(before, 'raise', 3);

    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('the derived-state invariant, over random legal play', () => {
  it('holds after any sequence of legal actions', () => {
    // The plan promised a property test here, not a single walked hand. Seeded,
    // so a failure names the hand and replays exactly.
    const rng = mulberry32(0xf01d);

    for (let hand = 0; hand < 400; hand++) {
      const tableSize = 2 + rng.nextInt(5);
      const stackDepth = 3 + rng.nextInt(98);
      const seated = POSITIONS.slice(POSITIONS.length - tableSize);
      const short = seated[rng.nextInt(seated.length)]!;

      let state = createHandState({
        tableSize,
        stackDepth,
        // Sometimes give one seat an odd stack, so short all-ins are common.
        ...(rng.nextInt(2) === 0 ? { stacks: { [short]: 1 + rng.nextInt(20) } } : {}),
      });

      const starting = new Map(
        state.seats.map((seat) => [seat.position, seat.stack + seat.totalCommitted]),
      );

      for (let step = 0; state.toAct !== undefined && step < 200; step++) {
        const legal = legalActions(state);
        expect(legal.length, `hand ${hand}: ${state.toAct} had no legal action`).toBeGreaterThan(0);

        const choice = legal[rng.nextInt(legal.length)]!;
        let size: number | undefined;
        if (choice.minTo !== undefined) {
          const span = [choice.minTo, choice.maxTo!, (choice.minTo + choice.maxTo!) / 2];
          const picked = Math.round(span[rng.nextInt(span.length)]! * 100) / 100;
          size = Math.min(choice.maxTo!, Math.max(choice.minTo, picked));
        }

        const before = state.history.length;
        state = applyAction(state, choice.action, size);

        const label = `hand ${hand} step ${step} (${choice.action})`;
        expect(state.history.length, label).toBe(before + 1);
        expect(potSize(state), label).toBeCloseTo(
          state.seats.reduce((sum, seat) => sum + seat.totalCommitted, 0),
          8,
        );

        for (const seat of state.seats) {
          expect(seat.stack, `${label} ${seat.position} stack`).toBeGreaterThanOrEqual(0);
          expect(seat.committed, `${label} ${seat.position}`).toBeLessThanOrEqual(
            seat.totalCommitted + 1e-9,
          );
          expect(seat.stack + seat.totalCommitted, `${label} ${seat.position} conserved`).toBeCloseTo(
            starting.get(seat.position)!,
            8,
          );
          if (seat.status === 'allin') {
            expect(seat.stack, `${label} ${seat.position} all-in with chips behind`).toBe(0);
          }
        }

        if (state.toAct !== undefined) {
          expect(seatAt(state, state.toAct).status, label).toBe('active');
        }

        const highest = state.seats.reduce((most, seat) => Math.max(most, seat.committed), 0);
        expect(currentBet(state), label).toBeGreaterThanOrEqual(highest - 1e-9);
      }

      expect(state.toAct, `hand ${hand} never terminated`).toBeUndefined();
    }
  }, 60_000);

  it('never lets a short blind lower what the others owe', () => {
    // A big blind all-in for less than one blind still leaves a live bet of a
    // full blind for everyone behind it.
    const state = createHandState({ stacks: { BB: 0.56 } });

    expect(seatAt(state, 'BB').status).toBe('allin');
    expect(currentBet(state)).toBe(1);
    expect(amountToCall(state, 'UTG')).toBe(1);
    expect(minRaiseTo(state)).toBe(2);
  });
});
