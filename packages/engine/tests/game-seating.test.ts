import { describe, expect, it } from 'vitest';

import { applyAction, createHandState, dealBoard, seatRing } from '../src/game';
import { parseCards } from '../src/cards';
import { POSITIONS } from '../src/ranges';

/**
 * `seatRing` is the whole data model for the table visualisation, and it exists
 * in here rather than in the component for the reason CLAUDE.md gives: reading
 * "what did this seat do" off `state.history` is poker logic.
 *
 * It replaces two separate derivations that had drifted apart — `TableSeats`
 * found its own seats and showed `totalCommitted`, `ActionHistory` filtered its
 * own history and showed actions — so the strip could say `2.5bb` while the
 * list beside it said `Raise to 2.5bb` about a seat that had since 3-bet.
 *
 * The two properties worth stating up front, because everything below is a
 * consequence of one of them:
 *
 *   1. The ring is returned in **action order**, and carries `ringIndex`
 *      separately. The component positions by index and never reorders, so
 *      the DOM a screen reader walks stays the order play happens in.
 *   2. `lastAction` is scoped to the **current street**. A preflop raise must
 *      stop labelling a seat the moment the flop comes out.
 */

const HERO = 'BTN';

describe('seatRing — shape', () => {
  const state = createHandState();

  it('returns every seat, in action order for the street', () => {
    const ring = seatRing(state, HERO);

    expect(ring.map((view) => view.position)).toEqual([...POSITIONS]);
  });

  it('numbers the ring clockwise from hero, who is always index 0', () => {
    const ring = seatRing(state, HERO);
    const indexOf = (position: string) =>
      ring.find((view) => view.position === position)?.ringIndex;

    // BTN sits at the bottom of the screen; the seat to its left is the SB, and
    // the ring walks up the left side from there. Getting this backwards puts
    // the blinds on the wrong side of hero, which is the one spatial fact the
    // whole visualisation exists to convey.
    expect(indexOf('BTN')).toBe(0);
    expect(indexOf('SB')).toBe(1);
    expect(indexOf('BB')).toBe(2);
    expect(indexOf('UTG')).toBe(3);
    expect(indexOf('HJ')).toBe(4);
    expect(indexOf('CO')).toBe(5);
  });

  it('wraps the ring for a hero in the blinds', () => {
    const ring = seatRing(state, 'BB');
    const indexOf = (position: string) =>
      ring.find((view) => view.position === position)?.ringIndex;

    // The big blind's left is UTG — which is why UTG acts first preflop — and
    // the small blind is immediately to its right, last around the ring.
    expect(indexOf('BB')).toBe(0);
    expect(indexOf('UTG')).toBe(1);
    expect(indexOf('HJ')).toBe(2);
    expect(indexOf('CO')).toBe(3);
    expect(indexOf('BTN')).toBe(4);
    expect(indexOf('SB')).toBe(5);

    // Action order is unchanged by who hero is — only the geometry rotates.
    expect(ring.map((view) => view.position)).toEqual([...POSITIONS]);
  });

  it('marks hero and whoever is to act, which are not the same question', () => {
    const ring = seatRing(state, HERO);

    expect(ring.filter((view) => view.isHero).map((v) => v.position)).toEqual(['BTN']);
    // Folded to nobody yet: UTG is first to act, hero is on the button.
    expect(ring.filter((view) => view.isToAct).map((v) => v.position)).toEqual(['UTG']);
  });

  it('rejects a hero who is not seated', () => {
    // A five-handed table has no UTG. Silently returning a ring with nobody
    // marked as hero would render a table the user is not sitting at.
    const short = createHandState({ tableSize: 5 });

    expect(() => seatRing(short, 'UTG')).toThrow(/UTG/);
  });
});

describe('seatRing — short-handed', () => {
  /**
   * `createHandState` drops the earliest positions first, so a 5-max table is
   * HJ..BB. The ring must contain what is seated and must not invent a UTG.
   */
  const state = createHandState({ tableSize: 5 });

  it('holds only the seated positions', () => {
    const ring = seatRing(state, HERO);

    expect(ring.map((view) => view.position)).toEqual(['HJ', 'CO', 'BTN', 'SB', 'BB']);
  });

  it('numbers the ring over the seats that exist', () => {
    const ring = seatRing(state, HERO);
    const indexOf = (position: string) =>
      ring.find((view) => view.position === position)?.ringIndex;

    expect(indexOf('BTN')).toBe(0);
    expect(indexOf('SB')).toBe(1);
    expect(indexOf('BB')).toBe(2);
    expect(indexOf('HJ')).toBe(3);
    expect(indexOf('CO')).toBe(4);

    // Five seats, five distinct indices, no gap where UTG would have been.
    expect(new Set(ring.map((view) => view.ringIndex))).toEqual(new Set([0, 1, 2, 3, 4]));
  });
});

describe('seatRing — what a seat did', () => {
  it('reads nothing for a seat yet to act', () => {
    const ring = seatRing(createHandState(), HERO);
    const utg = ring.find((view) => view.position === 'UTG')!;

    expect(utg.lastAction).toBeUndefined();
    expect(utg.postedBlind).toBe(false);
  });

  it('distinguishes a posted blind from a seat that has acted', () => {
    const ring = seatRing(createHandState(), HERO);

    // The blinds are posted by `createHandState` and never enter `history`, so
    // a component reading history alone would show the SB as having done
    // nothing while 0.5bb of its stack sat in the pot.
    const sb = ring.find((view) => view.position === 'SB')!;
    expect(sb.postedBlind).toBe(true);
    expect(sb.lastAction).toBeUndefined();
    expect(sb.seat.committed).toBe(0.5);

    const bb = ring.find((view) => view.position === 'BB')!;
    expect(bb.postedBlind).toBe(true);
    expect(bb.seat.committed).toBe(1);
  });

  it('reports the action a seat took', () => {
    const raised = applyAction(createHandState(), 'raise', 2.5);
    const utg = seatRing(raised, HERO).find((view) => view.position === 'UTG')!;

    expect(utg.lastAction).toMatchObject({ action: 'raise', size: 2.5, street: 'preflop' });
    // It has acted, so the blind framing no longer applies to anyone who moved.
    expect(utg.postedBlind).toBe(false);
  });

  it('reports the LATEST action, not the first', () => {
    // UTG opens, HJ 3-bets, it folds round to UTG, UTG 4-bets. A ring showing
    // the first entry would label UTG as having raised to 2.5 while 22bb of
    // its stack was in.
    //
    // The folds are not padding: action only returns to UTG once every seat
    // behind it has had a turn, so a two-line version of this test raises
    // twice from two different seats and proves nothing about "latest".
    let state = createHandState();
    state = applyAction(state, 'raise', 2.5); // UTG
    state = applyAction(state, 'raise', 8); // HJ
    state = applyAction(state, 'fold'); // CO
    state = applyAction(state, 'fold'); // BTN
    state = applyAction(state, 'fold'); // SB
    state = applyAction(state, 'fold'); // BB
    expect(state.toAct).toBe('UTG');
    state = applyAction(state, 'raise', 22); // UTG again

    const ring = seatRing(state, HERO);

    expect(ring.find((view) => view.position === 'UTG')!.lastAction).toMatchObject({
      action: 'raise',
      size: 22,
    });
    expect(ring.find((view) => view.position === 'HJ')!.lastAction).toMatchObject({
      action: 'raise',
      size: 8,
    });
  });

  it('scopes the action to the current street', () => {
    /**
     * The subtle one, and the reason `lastAction` is not simply the last
     * history entry for a position. Preflop aggression is over once the flop
     * is dealt; a seat still captioned "raised to 2.5bb" on the flop is
     * describing a bet that is already in the pot behind it.
     */
    let state = createHandState();
    state = applyAction(state, 'raise', 2.5); // UTG
    state = applyAction(state, 'fold'); // HJ
    state = applyAction(state, 'fold'); // CO
    state = applyAction(state, 'call'); // BTN
    state = applyAction(state, 'fold'); // SB
    state = applyAction(state, 'fold'); // BB

    expect(state.street).toBe('flop');

    state = dealBoard(state, parseCards('7h 2d 9c'));
    const ring = seatRing(state, HERO);

    for (const view of ring) {
      expect(view.lastAction, `${view.position} still carries a preflop action`).toBeUndefined();
    }

    // And a fold from preflop still reads as folded, because that is status,
    // not an action on this street.
    expect(ring.find((view) => view.position === 'HJ')!.seat.status).toBe('folded');
    expect(ring.find((view) => view.position === 'UTG')!.seat.status).toBe('active');

    // Nobody has a live bet on the new street, so nobody reads as a blind.
    expect(ring.every((view) => !view.postedBlind)).toBe(true);
  });

  it('keeps an all-in seat distinct from a folded one', () => {
    // Both are out of the action; only one of them is still in the hand, and a
    // table that greys them identically tells the user the pot is uncontested.
    let state = createHandState({ stacks: { UTG: 8 } });
    state = applyAction(state, 'allin');

    const utg = seatRing(state, HERO).find((view) => view.position === 'UTG')!;

    expect(utg.seat.status).toBe('allin');
    expect(utg.lastAction).toMatchObject({ action: 'allin' });
    expect(utg.seat.stack).toBe(0);
  });

  it('marks nobody to act once the hand is complete', () => {
    let state = createHandState();
    for (const action of ['fold', 'fold', 'fold', 'fold', 'fold'] as const) {
      state = applyAction(state, action);
    }

    expect(state.toAct).toBeUndefined();
    expect(seatRing(state, HERO).every((view) => !view.isToAct)).toBe(true);
  });
});
