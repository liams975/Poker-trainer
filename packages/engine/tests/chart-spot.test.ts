import { describe, expect, it } from 'vitest';

import { CANONICAL_HANDS, handNotationOf } from '../src/cards';
import { createChartRegistry } from '../src/ranges';
import type { Position, Range, RangeChart } from '../src/ranges';
import { chartSpot, explainChartHand } from '../src/strategy';

/**
 * A chart, as the spot it describes.
 *
 * The Range Explorer names its spot in words — "BB vs BTN open" — and for
 * anyone still learning what that *means*, the words are the hard part. A ring
 * with the button's chips already in it is not: position is geometry, which is
 * the whole argument Phase 11 made for the table in the first place.
 *
 * `explainChartHand` has been building exactly this state since Phase 6 in
 * order to ask the chart strategy for a rationale. So the table is drawn from
 * the same construction rather than a second one — the alternative being that
 * the picture and the explanation beside it come to disagree about which spot
 * is on screen.
 */

const OPEN: Range = {
  AA: [{ action: 'raise', size: 2.5, freq: 1 }],
  AKs: [{ action: 'raise', size: 2.5, freq: 1 }],
  '72o': [{ action: 'fold', freq: 1 }],
};

const DEFEND: Range = {
  AA: [{ action: 'raise', size: 11, freq: 1 }],
  AKs: [{ action: 'call', freq: 1 }],
  '72o': [{ action: 'fold', freq: 1 }],
};

const rfi = (heroPosition: Position): RangeChart => ({
  tableSize: 6,
  stackDepth: 100,
  heroPosition,
  actionSequence: 'rfi',
  skillTags: [],
  ranges: OPEN,
});

const defence: RangeChart = {
  tableSize: 6,
  stackDepth: 100,
  heroPosition: 'BB',
  actionSequence: 'vs_btn_open',
  skillTags: [],
  ranges: DEFEND,
};

const registry = createChartRegistry({
  version: 'test-1',
  published: true,
  charts: [rfi('UTG'), rfi('BTN'), defence],
});

describe('chartSpot', () => {
  it('builds an unopened pot for an opening chart', () => {
    const spot = chartSpot(rfi('UTG'), registry);

    expect(spot.hero).toBe('UTG');
    expect(spot.state.toAct).toBe('UTG');
    expect(spot.state.street).toBe('preflop');
    // Nobody has acted; only the blinds are in.
    expect(spot.state.history).toEqual([]);
    expect(spot.state.seats.find((seat) => seat.position === 'SB')!.committed).toBe(0.5);
  });

  it('puts the opener’s raise in, at the size their own chart opens to', () => {
    const spot = chartSpot(defence, registry);

    expect(spot.hero).toBe('BB');
    expect(spot.state.toAct).toBe('BB');

    const raise = spot.state.history.find((entry) => entry.action === 'raise');
    expect(raise?.position).toBe('BTN');
    // 2.5 comes from BTN's *rfi* chart. Reading it off the defence chart would
    // find 11 — a three-bet size — and replay a spot that never happened.
    expect(raise?.size).toBe(2.5);
    expect(spot.state.seats.find((seat) => seat.position === 'BTN')!.committed).toBe(2.5);
  });

  it('deals hero the hand it is asked for', () => {
    const spot = chartSpot(defence, registry, 'AKs');

    expect(spot.scenario.hand).toBe('AKs');
    const hole = spot.state.seats.find((seat) => seat.position === 'BB')!.hole!;
    expect(handNotationOf(hole[0], hole[1])).toBe('AKs');
  });

  it('deals a real hand when it is asked for none', () => {
    // The explorer draws the table before any cell is selected. The state still
    // needs cards in it, and they still have to be a hand that exists.
    const spot = chartSpot(rfi('UTG'), registry);

    const hole = spot.state.seats.find((seat) => seat.position === 'UTG')!.hole!;
    expect(CANONICAL_HANDS).toContain(handNotationOf(hole[0], hole[1]));
  });

  it('refuses a hand that is not one of the 169', () => {
    expect(() => chartSpot(rfi('UTG'), registry, 'AKx' as never)).toThrow(/canonical/);
  });

  it('refuses a defence chart with no opener chart to price the raise from', () => {
    const orphan: RangeChart = { ...defence, actionSequence: 'vs_co_open' };

    expect(() => chartSpot(orphan, registry)).toThrow(/co/i);
  });

  it('is the state explainChartHand explains', () => {
    /**
     * One construction, not two. If these ever diverge the explorer draws one
     * spot and explains another, which is the single worst failure this screen
     * could have.
     */
    const spot = chartSpot(defence, registry, 'AKs');
    const explained = explainChartHand({
      chart: defence,
      hand: 'AKs',
      registry,
      chartVersion: 'test-1',
    });

    expect(explained.source).toBe('chart');
    // The rationale is derived from the spot above; agreeing on the sequence is
    // what says they were built from the same state.
    const sequence = explained.rationale.factors.find(
      (item) => item.kind === 'action_sequence',
    );
    expect(sequence?.detail.sequence).toBe(spot.scenario.actionSequence);
  });
});
