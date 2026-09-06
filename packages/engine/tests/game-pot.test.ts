import { describe, expect, it } from 'vitest';

import { applyAction, buildPots, createHandState, uncalledPortion } from '../src/game';
import type { HandState, Seat, SeatStatus } from '../src/game';
import type { Position } from '../src/ranges';

/**
 * Side pots, as arithmetic.
 *
 * `betting.ts` has carried this since Phase 3: "two deliberate omissions
 * recorded in the plan: side pots are not split, and no showdown is awarded."
 * Phase 12a needs both, because a bot hand has to end with somebody's stack
 * going up by the right amount.
 *
 * **Every case here is a way a real implementation pays the wrong player**, and
 * none of them is visible from the outside — a side-pot bug does not crash, it
 * quietly moves money. Which is why the invariant the simulation leans on is
 * chip conservation, and why this file tests the arithmetic on its own before
 * anything evaluates a hand.
 *
 * The contract between the two functions, and the thing conservation rests on:
 *
 *     sum(buildPots) + uncalledPortion == sum(totalCommitted)
 *
 * Most cases are built as literal states rather than played out. That is
 * deliberate — the scenarios worth testing are ones that take a specific
 * sequence of raises and all-ins to reach, and spelling the sequence out hides
 * what is being asserted. The last describe block plays real hands so the two
 * constructions cannot drift.
 */

/** A `HandState` with only the fields side-pot arithmetic reads. */
function stateWith(
  seats: readonly { at: Position; put: number; status?: SeatStatus }[],
): HandState {
  return {
    tableSize: 6,
    stackDepth: 100,
    smallBlind: 0.5,
    bigBlind: 1,
    street: 'river',
    seats: seats.map(
      ({ at, put, status = 'active' }): Seat => ({
        position: at,
        stack: 0,
        committed: 0,
        totalCommitted: put,
        status,
      }),
    ),
    board: [],
    toAct: undefined,
    history: [],
  };
}

const total = (state: HandState): number =>
  state.seats.reduce((sum, seat) => sum + seat.totalCommitted, 0);

/** The contract every case must satisfy: nothing is created and nothing lost. */
function expectConserved(state: HandState): void {
  const pots = buildPots(state).reduce((sum, pot) => sum + pot.amount, 0);
  const returned = uncalledPortion(state)?.amount ?? 0;

  expect(pots + returned, 'pots plus the uncalled return must equal what went in').toBeCloseTo(
    total(state),
    10,
  );
}

describe('buildPots — one pot', () => {
  it('pools an ordinary called bet', () => {
    const state = stateWith([
      { at: 'BTN', put: 10 },
      { at: 'BB', put: 10 },
    ]);

    expect(buildPots(state)).toEqual([{ amount: 20, eligible: ['BB', 'BTN'] }]);
    expect(uncalledPortion(state)).toBeUndefined();
    expectConserved(state);
  });

  it('makes one pot, not two empty ones, when two seats are all-in for the same', () => {
    const state = stateWith([
      { at: 'BTN', put: 40, status: 'allin' },
      { at: 'BB', put: 40, status: 'allin' },
    ]);

    expect(buildPots(state)).toHaveLength(1);
    expectConserved(state);
  });

  it('counts a folded seat’s chips as dead money it cannot win', () => {
    // The commonest way to lose chips: treating "folded" as "not in the pot".
    const state = stateWith([
      { at: 'UTG', put: 10, status: 'folded' },
      { at: 'BTN', put: 10 },
      { at: 'BB', put: 10 },
    ]);

    const pots = buildPots(state);

    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount, 'the folded seat’s 10 vanished').toBe(30);
    expect(pots[0]!.eligible).not.toContain('UTG');
    expectConserved(state);
  });
});

describe('buildPots — side pots', () => {
  it('splits a short all-in into a main pot and a side pot', () => {
    // The canonical case. A is in for 20 and can win only what he covered.
    const state = stateWith([
      { at: 'CO', put: 20, status: 'allin' },
      { at: 'BTN', put: 50 },
      { at: 'BB', put: 50 },
    ]);

    const pots = buildPots(state);

    expect(pots).toHaveLength(2);
    expect(pots[0]).toEqual({ amount: 60, eligible: ['BB', 'CO', 'BTN'] });
    expect(pots[1]).toEqual({ amount: 60, eligible: ['BB', 'BTN'] });
    expectConserved(state);
  });

  it('builds three layers for two all-ins at different depths', () => {
    const state = stateWith([
      { at: 'UTG', put: 10, status: 'allin' },
      { at: 'CO', put: 40, status: 'allin' },
      { at: 'BTN', put: 90 },
      { at: 'BB', put: 90 },
    ]);

    const pots = buildPots(state);

    expect(pots.map((pot) => pot.amount)).toEqual([40, 90, 100]);
    expect(pots[0]!.eligible).toHaveLength(4);
    expect(pots[1]!.eligible).toEqual(['BB', 'CO', 'BTN']);
    expect(pots[2]!.eligible).toEqual(['BB', 'BTN']);
    expectConserved(state);
  });

  it('puts a folded seat’s partial call in the layer it actually reached', () => {
    /**
     * The subtle one. UTG folded having put 35 in — 20 of that belongs in the
     * main pot and 15 in the side pot, because 35 is above the short stack's 20.
     * Sweeping all 35 into the main pot overpays the player the short stack
     * covered and underpays the side pot.
     */
    const state = stateWith([
      { at: 'UTG', put: 35, status: 'folded' },
      { at: 'HJ', put: 20, status: 'allin' },
      { at: 'BTN', put: 50 },
      { at: 'BB', put: 50 },
    ]);

    const pots = buildPots(state);

    expect(pots).toHaveLength(2);
    expect(pots[0]!.amount, 'main pot should be four times the 20 level').toBe(80);
    expect(pots[1]!.amount, 'the side pot is missing the folded seat’s extra 15').toBe(75);
    expect(pots[1]!.eligible).toEqual(['BB', 'BTN']);
    expectConserved(state);
  });

  it('never lists a folded seat as eligible, at any layer', () => {
    const state = stateWith([
      { at: 'UTG', put: 90, status: 'folded' },
      { at: 'CO', put: 20, status: 'allin' },
      { at: 'BTN', put: 90 },
    ]);

    for (const pot of buildPots(state)) {
      expect(pot.eligible).not.toContain('UTG');
    }
    expectConserved(state);
  });
});

describe('uncalledPortion', () => {
  it('returns the excess of a shove nobody called', () => {
    // Hero shoves 50 into a pot where the most anyone else put in is 12.
    const state = stateWith([
      { at: 'CO', put: 12, status: 'folded' },
      { at: 'BTN', put: 50 },
    ]);

    expect(uncalledPortion(state)).toEqual({ position: 'BTN', amount: 38 });
    expect(buildPots(state)).toEqual([{ amount: 24, eligible: ['BTN'] }]);
    expectConserved(state);
  });

  it('returns nothing when the top bet was matched', () => {
    const state = stateWith([
      { at: 'BTN', put: 50 },
      { at: 'BB', put: 50 },
    ]);

    expect(uncalledPortion(state)).toBeUndefined();
  });

  it('hands the big blind its own blind back when everyone folds to it', () => {
    /**
     * Not a special case, which is the point of deriving this rather than
     * writing a rule for it: the big blind is the highest contributor and the
     * small blind is the second, so 0.5 comes back and the pot is 1.0. The big
     * blind nets exactly the small blind, which is what winning the blinds is.
     */
    const state = stateWith([
      { at: 'SB', put: 0.5, status: 'folded' },
      { at: 'BB', put: 1 },
    ]);

    expect(uncalledPortion(state)).toEqual({ position: 'BB', amount: 0.5 });
    expect(buildPots(state)).toEqual([{ amount: 1, eligible: ['BB'] }]);
    expectConserved(state);
  });

  it('measures the excess against every seat, folded ones included', () => {
    // UTG's folded 20 is called money and caps what comes back, even though
    // UTG cannot win any of it.
    const state = stateWith([
      { at: 'UTG', put: 20, status: 'folded' },
      { at: 'BTN', put: 60 },
    ]);

    expect(uncalledPortion(state)).toEqual({ position: 'BTN', amount: 40 });
    expectConserved(state);
  });

  it('returns nothing when two seats tie for the highest contribution', () => {
    const state = stateWith([
      { at: 'CO', put: 30, status: 'allin' },
      { at: 'BTN', put: 30, status: 'allin' },
      { at: 'BB', put: 12, status: 'folded' },
    ]);

    expect(uncalledPortion(state)).toBeUndefined();
    expectConserved(state);
  });
});

describe('buildPots — against hands actually played', () => {
  /**
   * The literal states above are readable; these are real. If the two ever
   * disagree about what a sequence of actions produces, one of them is lying
   * about the betting rules.
   */
  it('agrees with a folded-round preflop', () => {
    let state = createHandState();
    for (let i = 0; i < 5; i++) state = applyAction(state, 'fold');

    expect(state.toAct).toBeUndefined();
    expect(uncalledPortion(state)).toEqual({ position: 'BB', amount: 0.5 });
    expect(buildPots(state)).toEqual([{ amount: 1, eligible: ['BB'] }]);
    expectConserved(state);
  });

  it('agrees with an open that took the blinds', () => {
    let state = createHandState();
    state = applyAction(state, 'raise', 3); // UTG
    for (let i = 0; i < 5; i++) state = applyAction(state, 'fold');

    expect(uncalledPortion(state)).toEqual({ position: 'UTG', amount: 2 });
    expect(buildPots(state)).toEqual([{ amount: 2.5, eligible: ['UTG'] }]);
    expectConserved(state);
  });

  it('agrees with a short stack all-in against two callers', () => {
    let state = createHandState({ stacks: { CO: 20 } });
    state = applyAction(state, 'fold'); // UTG
    state = applyAction(state, 'fold'); // HJ
    state = applyAction(state, 'allin'); // CO, for 20
    state = applyAction(state, 'call'); // BTN
    state = applyAction(state, 'fold'); // SB
    state = applyAction(state, 'call'); // BB

    const pots = buildPots(state);

    // Everyone live is in for 20; the small blind's 0.5 is dead money in it.
    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(60.5);
    expect(pots[0]!.eligible).toEqual(['BB', 'CO', 'BTN']);
    expectConserved(state);
  });
});
