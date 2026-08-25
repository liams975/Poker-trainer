import { describe, expect, it } from 'vitest';

import { parseCards } from '../src/cards';
import { applyAction, createHandState } from '../src/game';
import { classifyBoard, potOdds, spr } from '../src/strategy';

/**
 * docs/02-roadmap.md Phase 3 asks for "postflop heuristic stubs: board texture
 * classification, SPR, pot odds". These are primitives, deliberately not a
 * strategy — nothing here decides an action. A crude postflop strategy that
 * could *grade* a user would risk teaching wrong play, which is the one thing
 * this product cannot afford.
 */

const board = (text: string) => parseCards(text);

describe('classifyBoard', () => {
  it.each([
    ['Ah Kd 7c', 'rainbow, unpaired, disconnected'],
    ['Ah Kh 7h', 'monotone'],
    ['Ah Kh 7c', 'two-tone'],
    ['7h 7d 2c', 'paired'],
    ['7h 7d 7c', 'trips'],
    ['9h 8d 7c', 'connected'],
  ])('classifies %s (%s)', (text) => {
    expect(() => classifyBoard(board(text))).not.toThrow();
  });

  it('reads a rainbow, unpaired, disconnected board', () => {
    expect(classifyBoard(board('Ah Kd 7c'))).toEqual({
      paired: false,
      trips: false,
      monotone: false,
      twoTone: false,
      rainbow: true,
      connected: false,
      highCard: 12,
    });
  });

  it('reads a monotone board', () => {
    const texture = classifyBoard(board('Ah Kh 7h'));

    expect(texture.monotone).toBe(true);
    expect(texture.twoTone).toBe(false);
    expect(texture.rainbow).toBe(false);
  });

  it('reads a two-tone board', () => {
    const texture = classifyBoard(board('Ah Kh 7c'));

    expect(texture.twoTone).toBe(true);
    expect(texture.monotone).toBe(false);
    expect(texture.rainbow).toBe(false);
  });

  it('separates a pair from trips', () => {
    expect(classifyBoard(board('7h 7d 2c')).paired).toBe(true);
    expect(classifyBoard(board('7h 7d 2c')).trips).toBe(false);
    expect(classifyBoard(board('7h 7d 7c')).trips).toBe(true);
    expect(classifyBoard(board('7h 7d 7c')).paired).toBe(true);
  });

  it('calls a straight-possible board connected', () => {
    expect(classifyBoard(board('9h 8d 7c')).connected).toBe(true);
    expect(classifyBoard(board('9h 8d 5c')).connected).toBe(true);
    expect(classifyBoard(board('Ah 8d 3c')).connected).toBe(false);
  });

  it('treats the ace as low for a wheel-ish board', () => {
    // A 2 3 is one card off a straight, exactly as 9 8 7 is.
    expect(classifyBoard(board('Ah 2d 3c')).connected).toBe(true);
  });

  it('reports the highest rank', () => {
    expect(classifyBoard(board('Ah Kd 7c')).highCard).toBe(12);
    expect(classifyBoard(board('9h 8d 7c')).highCard).toBe(7);
  });

  it('handles four- and five-card boards', () => {
    expect(classifyBoard(board('Ah Kd 7c 2s')).highCard).toBe(12);
    expect(classifyBoard(board('Ah Kd 7c 2s 4h')).paired).toBe(false);
    expect(classifyBoard(board('Ah Kh 7h 2h 4d')).monotone).toBe(false);
    // Four to a flush on a four-card board is monotone by any reading.
    expect(classifyBoard(board('Ah Kh 7h 2h')).monotone).toBe(true);
    expect(classifyBoard(board('Ah Kh 7h 2c')).twoTone).toBe(true);
  });

  it('cannot call a five-card board rainbow', () => {
    // Rainbow means no two cards share a suit, which five cards cannot manage.
    expect(classifyBoard(board('Ah Kd 7c 2s 4h')).rainbow).toBe(false);
    expect(classifyBoard(board('Ah Kd 7c 2s')).rainbow).toBe(true);
  });

  it.each([0, 1, 2, 6])('rejects a board of %i cards', (count) => {
    expect(() => classifyBoard(board('AhKd7c2s4h9d').slice(0, count))).toThrow(RangeError);
  });
});

describe('potOdds', () => {
  it('is zero when there is nothing to call', () => {
    const state = createHandState();

    expect(potOdds(state, 'BB')).toEqual({ toCall: 0, pot: 1.5, requiredEquity: 0 });
  });

  it('computes the break-even equity for a call', () => {
    // UTG opens to 3. BB has 1 in, so owes 2 into a pot of 4.5.
    let state = applyAction(createHandState(), 'raise', 3);
    for (const position of ['HJ', 'CO', 'BTN', 'SB'] as const) {
      // Asserting the turn as we go: the fold order is the action order.
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }

    const odds = potOdds(state, 'BB');

    expect(odds.toCall).toBe(2);
    expect(odds.pot).toBe(4.5);
    expect(odds.requiredEquity).toBeCloseTo(2 / 6.5, 10);
  });

  it('caps what a short stack can call', () => {
    let state = applyAction(createHandState({ stacks: { BB: 4 } }), 'raise', 20);
    for (const position of ['HJ', 'CO', 'BTN', 'SB'] as const) {
      // Asserting the turn as we go: the fold order is the action order.
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }

    // BB has 1 posted and only 3 behind, so it can never owe 19.
    expect(potOdds(state, 'BB').toCall).toBe(3);
  });
});

describe('spr', () => {
  it('is the effective stack over the pot', () => {
    let state = applyAction(createHandState(), 'raise', 3);
    for (const position of ['HJ', 'CO', 'BTN', 'SB'] as const) {
      // Asserting the turn as we go: the fold order is the action order.
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }
    state = applyAction(state, 'call');

    // Pot 6.5 after BB calls; both survivors have 97 behind.
    expect(spr(state, 'BB')).toBeCloseTo(97 / 6.5, 6);
  });

  it('uses the shorter of the two stacks', () => {
    let state = applyAction(createHandState({ stacks: { BB: 30 } }), 'raise', 3);
    for (const position of ['HJ', 'CO', 'BTN', 'SB'] as const) {
      // Asserting the turn as we go: the fold order is the action order.
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }
    state = applyAction(state, 'call');

    // BB is the short one: 30 - 3 = 27 behind against UTG's 97.
    expect(spr(state, 'BB')).toBeCloseTo(27 / 6.5, 6);
    expect(spr(state, 'UTG')).toBeCloseTo(27 / 6.5, 6);
  });

  it('is zero when a player is all-in', () => {
    let state = applyAction(createHandState({ stacks: { UTG: 10 } }), 'allin');
    for (const position of ['HJ', 'CO', 'BTN', 'SB'] as const) {
      // Asserting the turn as we go: the fold order is the action order.
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }
    state = applyAction(state, 'call');

    expect(spr(state, 'UTG')).toBe(0);
  });
});
