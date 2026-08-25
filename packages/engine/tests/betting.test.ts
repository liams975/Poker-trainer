import { describe, expect, it } from 'vitest';

import type { HandState } from '../src/game';
import {
  applyAction,
  createHandState,
  currentBet,
  isHandComplete,
  legalActions,
  minRaiseTo,
  potSize,
  seatAt,
} from '../src/game';

/**
 * docs/03-poker-engine.md, test plan for `game`: "Legal-action correctness at
 * each state. Pot math. Invalid transitions rejected."
 *
 * v1 only drills preflop, but these are the rules a v2 bot will play by, and a
 * bot that raises illegally is a bug found in production. The subtle one is the
 * short all-in: an all-in that does not amount to a full raise does not reopen
 * the betting to players who have already acted.
 */

function names(state: HandState): string[] {
  return legalActions(state).map((a) => a.action);
}

function walk(state: HandState, steps: Array<[string, number?]>): HandState {
  return steps.reduce(
    (s, [action, size]) => applyAction(s, action as never, size),
    state,
  );
}

describe('legal actions at the open', () => {
  const state = createHandState();

  it('offers fold, call, raise and all-in to UTG', () => {
    expect(names(state).sort()).toEqual(['allin', 'call', 'fold', 'raise']);
  });

  it('offers no check, because the big blind is already a live bet', () => {
    expect(names(state)).not.toContain('check');
  });

  it('offers no bet preflop, for the same reason', () => {
    expect(names(state)).not.toContain('bet');
  });

  it('bounds the raise between the minimum and the whole stack', () => {
    const raise = legalActions(state).find((a) => a.action === 'raise')!;

    expect(raise.minTo).toBe(2);
    expect(raise.maxTo).toBe(100);
  });
});

describe('folding around', () => {
  it('ends the hand when everyone folds to the big blind', () => {
    const state = walk(createHandState(), [
      ['fold'], ['fold'], ['fold'], ['fold'], ['fold'],
    ]);

    expect(isHandComplete(state)).toBe(true);
    expect(state.toAct).toBeUndefined();
    // The blinds are still in the pot; nothing is awarded here because
    // showdown and side pots are out of scope for this phase.
    expect(potSize(state)).toBe(1.5);
  });

  it('records who folded and on which street', () => {
    const state = applyAction(createHandState(), 'fold');

    expect(state.history).toEqual([
      { street: 'preflop', position: 'UTG', action: 'fold' },
    ]);
    expect(seatAt(state, 'UTG').status).toBe('folded');
  });
});

describe('the big blind option', () => {
  const limped = walk(createHandState(), [
    ['call'], ['fold'], ['fold'], ['fold'], ['call'],
  ]);

  it('does not close the round when the big blind has only posted', () => {
    // BB has matched the current bet but has not acted. Closing here would
    // silently deny the option, which is a real rule and a common bug.
    expect(limped.toAct).toBe('BB');
    expect(isHandComplete(limped)).toBe(false);
  });

  it('lets the big blind check or raise', () => {
    expect(names(limped).sort()).toEqual(['allin', 'check', 'raise']);
  });

  it('does not offer a fold when checking is free', () => {
    // Folding for zero is strictly dominated and no chart ever prescribes it.
    expect(names(limped)).not.toContain('fold');
  });

  it('advances to the flop when the option is checked', () => {
    const flop = applyAction(limped, 'check');

    expect(flop.street).toBe('flop');
    expect(flop.toAct).toBe('SB');
    expect(currentBet(flop)).toBe(0);
    for (const seat of flop.seats) expect(seat.committed).toBe(0);
    expect(potSize(flop)).toBe(3);
  });

  it('reopens the betting when the option is raised', () => {
    const raised = applyAction(limped, 'raise', 4);

    expect(raised.street).toBe('preflop');
    expect(raised.toAct).toBe('UTG');
    expect(names(raised)).toContain('raise');
  });
});

describe('raising', () => {
  it('walks an open, a three-bet and a four-bet', () => {
    let state = applyAction(createHandState(), 'raise', 3);
    expect(minRaiseTo(state)).toBe(5);

    state = walk(state, [['fold'], ['raise', 9]]);
    expect(currentBet(state)).toBe(9);
    expect(minRaiseTo(state)).toBe(15);

    state = walk(state, [['fold'], ['fold'], ['fold']]);
    expect(state.toAct).toBe('UTG');

    state = applyAction(state, 'raise', 21);
    expect(currentBet(state)).toBe(21);
    expect(seatAt(state, 'UTG').totalCommitted).toBe(21);
  });

  it.each([1.5, 1.9])('rejects a raise to %s, below the minimum', (size) => {
    expect(() => applyAction(createHandState(), 'raise', size)).toThrow(RangeError);
  });

  it('rejects a raise beyond the stack', () => {
    expect(() => applyAction(createHandState(), 'raise', 101)).toThrow(RangeError);
  });

  it('rejects a raise with no size', () => {
    expect(() => applyAction(createHandState(), 'raise')).toThrow();
  });

  it('accepts a raise to exactly the minimum', () => {
    expect(() => applyAction(createHandState(), 'raise', 2)).not.toThrow();
  });
});

describe('a short all-in does not reopen the betting', () => {
  // HJ can only shove 4 over UTG's raise to 3. That is an increment of 1
  // against a last full increment of 2, so it is not a raise.
  const short = walk(createHandState({ stacks: { HJ: 4 } }), [
    ['raise', 3], ['allin'],
  ]);

  it('still counts as the current bet', () => {
    expect(currentBet(short)).toBe(4);
    expect(seatAt(short, 'HJ').status).toBe('allin');
  });

  it('does not advance the minimum raise', () => {
    // Min raise stays anchored to the last *full* increment: 4 + 2, not 4 + 1.
    expect(minRaiseTo(short)).toBe(6);
  });

  it('still lets a player who has not acted raise', () => {
    expect(short.toAct).toBe('CO');
    expect(names(short)).toContain('raise');
  });

  it('denies a re-raise to the player who was already all-in-ed into', () => {
    const backToUtg = walk(short, [['fold'], ['fold'], ['fold'], ['fold']]);

    expect(backToUtg.toAct).toBe('UTG');
    expect(names(backToUtg).sort()).toEqual(['call', 'fold']);
  });

  it('reopens the betting once someone makes a full raise', () => {
    const reopened = walk(short, [['raise', 8], ['fold'], ['fold'], ['fold']]);

    expect(reopened.toAct).toBe('UTG');
    expect(names(reopened)).toContain('raise');
  });
});

describe('all-in', () => {
  it('is offered only as aggression, never as a short call', () => {
    // A stack too small to cover the call is handled by `call`, capped. Two
    // names for one physical act would be a grading hazard downstream.
    const facingShove = walk(createHandState({ stacks: { BB: 60 } }), [
      ['allin'], ['fold'], ['fold'], ['fold'], ['fold'],
    ]);

    expect(facingShove.toAct).toBe('BB');
    expect(names(facingShove).sort()).toEqual(['call', 'fold']);
  });

  it('caps a call at the caller stack and marks them all-in', () => {
    const called = walk(createHandState({ stacks: { BB: 60 } }), [
      ['allin'], ['fold'], ['fold'], ['fold'], ['fold'], ['call'],
    ]);

    expect(seatAt(called, 'BB').totalCommitted).toBe(60);
    expect(seatAt(called, 'BB').stack).toBe(0);
    expect(seatAt(called, 'BB').status).toBe('allin');
  });

  it('records the total committed as its size', () => {
    const shoved = applyAction(createHandState({ stacks: { UTG: 25 } }), 'allin');

    expect(shoved.history[0]).toEqual({
      street: 'preflop',
      position: 'UTG',
      action: 'allin',
      size: 25,
    });
  });
});

describe('invalid transitions', () => {
  it('rejects checking when facing a bet', () => {
    expect(() => applyAction(createHandState(), 'check')).toThrow(RangeError);
  });

  it('rejects betting preflop', () => {
    expect(() => applyAction(createHandState(), 'bet', 3)).toThrow(RangeError);
  });

  it('rejects calling when there is nothing to call', () => {
    const limped = walk(createHandState(), [
      ['call'], ['fold'], ['fold'], ['fold'], ['call'],
    ]);

    expect(() => applyAction(limped, 'call')).toThrow(RangeError);
  });

  it('rejects acting after the hand is complete', () => {
    const done = walk(createHandState(), [
      ['fold'], ['fold'], ['fold'], ['fold'], ['fold'],
    ]);

    expect(() => applyAction(done, 'fold')).toThrow();
  });

  it('rejects an action that is not in the legal set', () => {
    expect(() => applyAction(createHandState(), 'allin', 3)).toThrow();
  });
});

describe('postflop', () => {
  const flop = walk(createHandState(), [
    ['call'], ['fold'], ['fold'], ['fold'], ['call'], ['check'],
  ]);

  it('opens on the small blind with check and bet available', () => {
    expect(flop.toAct).toBe('SB');
    expect(names(flop).sort()).toEqual(['allin', 'bet', 'check']);
  });

  it('offers no call and no raise when nobody has bet', () => {
    expect(names(flop)).not.toContain('call');
    expect(names(flop)).not.toContain('raise');
  });

  it('opens the minimum bet at one big blind', () => {
    const bet = legalActions(flop).find((a) => a.action === 'bet')!;

    expect(bet.minTo).toBe(1);
    expect(bet.maxTo).toBe(99);
  });

  it('advances through the streets when everyone checks', () => {
    let state = flop;
    for (const street of ['flop', 'turn', 'river'] as const) {
      expect(state.street).toBe(street);
      state = walk(state, [['check'], ['check'], ['check']]);
    }

    expect(isHandComplete(state)).toBe(true);
  });

  it('lets a bet be raised', () => {
    const raised = walk(flop, [['bet', 3], ['raise', 9]]);

    expect(currentBet(raised)).toBe(9);
    expect(minRaiseTo(raised)).toBe(15);
  });
});

describe('a short all-in postflop', () => {
  // Every other reopening case in this file starts from an empty history, so
  // the street filtering inside `streetBetting` is invisible to them. Here the
  // flop actions sit at history indices 6+, which is what actually exercises
  // the global-index arithmetic the reopening rule depends on.
  const flop = walk(createHandState({ stacks: { BB: 5 } }), [
    ['call'], ['fold'], ['fold'], ['fold'], ['call'], ['check'],
  ]);

  it('reaches the flop three-handed with a short big blind', () => {
    expect(flop.street).toBe('flop');
    expect(seatAt(flop, 'BB').stack).toBe(4);
    expect(flop.history).toHaveLength(6);
  });

  const shoved = walk(flop, [['bet', 3], ['allin']]);

  it('raises the bet without advancing the minimum raise', () => {
    expect(currentBet(shoved)).toBe(4);
    expect(minRaiseTo(shoved)).toBe(7); // 4 + the last full increment of 3
  });

  it('still lets a player who has not acted this street raise', () => {
    expect(shoved.toAct).toBe('UTG');
    expect(names(shoved)).toContain('raise');
  });

  it('denies a re-raise to the player who was shoved over', () => {
    const backToSb = applyAction(shoved, 'call');

    expect(backToSb.toAct).toBe('SB');
    expect(names(backToSb).sort()).toEqual(['call', 'fold']);
  });
});

describe('one name per physical act', () => {
  it('records a raise that commits the whole stack as an all-in', () => {
    // `drill_attempts.user_action` must not hold two names for the same act;
    // Phase 3b grades against that column.
    const shove = applyAction(createHandState({ stacks: { UTG: 8 } }), 'raise', 8);

    expect(shove.history[0]).toEqual({
      street: 'preflop',
      position: 'UTG',
      action: 'allin',
      size: 8,
    });
    expect(seatAt(shove, 'UTG').status).toBe('allin');
  });

  it('produces an identical state either way', () => {
    const viaRaise = applyAction(createHandState({ stacks: { UTG: 8 } }), 'raise', 8);
    const viaAllin = applyAction(createHandState({ stacks: { UTG: 8 } }), 'allin');

    expect(viaRaise).toEqual(viaAllin);
  });

  it('leaves a raise that does not commit the stack alone', () => {
    const raise = applyAction(createHandState(), 'raise', 3);

    expect(raise.history[0]?.action).toBe('raise');
  });
});
