import { describe, expect, it } from 'vitest';

import type { Combo } from '../src/cards';
import { parseCards } from '../src/cards';
import { applyAction, createHandState } from '../src/game';
import type { Position, Range, RangeChart } from '../src/ranges';
import {
  STACK_DEPTH_100BB,
  TABLE_SIZE_6MAX,
  createChartRegistry,
  handStrategy,
} from '../src/ranges';
import { createChartStrategy, explainChartHand } from '../src/strategy';

/**
 * The Range Explorer browses charts with no hand in progress, so it has no
 * `HandState` to hand to `Strategy.recommend`. `explainChartHand` is the way in
 * from a chart key alone.
 *
 * The property that matters is not that it produces *a* rationale — it is that
 * it produces the *same* rationale the drill will. If the study tool and the
 * trainer can disagree about why a hand plays the way it does, studying makes
 * you worse at the drill. These tests pin that agreement.
 */

function combo(text: string): Combo {
  const [a, b] = parseCards(text);
  return [a!, b!];
}

const OPEN: Range = {
  AA: [{ action: 'raise', size: 2.5, freq: 1 }],
  AJo: [
    { action: 'raise', size: 2.5, freq: 0.6 },
    { action: 'fold', freq: 0.4 },
  ],
  '72o': [{ action: 'fold', freq: 1 }],
};

const DEFEND: Range = {
  AA: [{ action: 'raise', size: 11, freq: 1 }],
  KQo: [
    { action: 'call', freq: 0.7 },
    { action: 'fold', freq: 0.3 },
  ],
};

function chart(heroPosition: Position, actionSequence: string, ranges: Range): RangeChart {
  return {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition,
    actionSequence,
    skillTags: [],
    ranges,
  };
}

const BTN_RFI = chart('BTN', 'rfi', OPEN);
const BB_VS_BTN = chart('BB', 'vs_btn_open', DEFEND);

const registry = createChartRegistry({
  version: 'test-1',
  published: true,
  charts: [BTN_RFI, BB_VS_BTN],
});

const strategy = createChartStrategy({ registry, chartVersion: 'test-1' });

describe('explainChartHand', () => {
  it('explains the chart it was given, not a re-derived one', () => {
    const result = explainChartHand({
      chart: BTN_RFI,
      hand: 'AJo',
      registry,
      chartVersion: 'test-1',
    });

    expect(result.frequencies).toEqual(handStrategy(OPEN, 'AJo'));
    expect(result.primary).toBe('raise');
    expect(result.source).toBe('chart');
    expect(result.chartVersion).toBe('test-1');
  });

  it('carries the factor kinds the detail panel renders as chips', () => {
    const { rationale } = explainChartHand({
      chart: BTN_RFI,
      hand: 'AJo',
      registry,
      chartVersion: 'test-1',
    });

    const kinds = rationale.factors.map((f) => f.kind);

    expect(kinds).toContain('position');
    expect(kinds).toContain('hand_class');
    expect(kinds).toContain('action_sequence');
    expect(kinds).toContain('range_shape');
    // AJo is 60/40, so the mix factor is the whole point of showing it.
    expect(kinds).toContain('mix');
  });

  it('omits the mix factor for a pure strategy', () => {
    const { rationale } = explainChartHand({
      chart: BTN_RFI,
      hand: 'AA',
      registry,
      chartVersion: 'test-1',
    });

    expect(rationale.factors.map((f) => f.kind)).not.toContain('mix');
  });

  /**
   * The agreement test. A drill spot is built from real hole cards chosen by
   * the generator; the explorer has only a hand notation and picks a
   * representative combo. Both must explain the spot identically, or the choice
   * of combo has leaked into the explanation.
   */
  it('agrees with the drill path for an unopened pot', () => {
    let state = createHandState({
      tableSize: TABLE_SIZE_6MAX,
      stackDepth: STACK_DEPTH_100BB,
      hole: { BTN: combo('Ah Js') },
    });
    // Fold UTG, HJ, CO so the action reaches the button first-in.
    state = applyAction(state, 'fold');
    state = applyAction(state, 'fold');
    state = applyAction(state, 'fold');

    const fromDrill = strategy.recommend(state, 'BTN');
    const fromExplorer = explainChartHand({
      chart: BTN_RFI,
      hand: 'AJo',
      registry,
      chartVersion: 'test-1',
    });

    expect(fromExplorer.rationale).toEqual(fromDrill.rationale);
    expect(fromExplorer.frequencies).toEqual(fromDrill.frequencies);
    expect(fromExplorer.primary).toBe(fromDrill.primary);
  });

  it('agrees with the drill path facing an open, where hero has nobody behind', () => {
    let state = createHandState({
      tableSize: TABLE_SIZE_6MAX,
      stackDepth: STACK_DEPTH_100BB,
      hole: { BB: combo('Kh Qs') },
    });
    state = applyAction(state, 'fold'); // UTG
    state = applyAction(state, 'fold'); // HJ
    state = applyAction(state, 'fold'); // CO
    state = applyAction(state, 'raise', 2.5); // BTN opens
    state = applyAction(state, 'fold'); // SB

    const fromDrill = strategy.recommend(state, 'BB');
    const fromExplorer = explainChartHand({
      chart: BB_VS_BTN,
      hand: 'KQo',
      registry,
      chartVersion: 'test-1',
    });

    expect(fromExplorer.rationale).toEqual(fromDrill.rationale);
    expect(fromExplorer.frequencies).toEqual(fromDrill.frequencies);
  });

  it('explains a hand the chart omits as the fold it is', () => {
    // Absent means always-fold (ranges/range.ts), and the explorer renders
    // those cells too, so they must explain rather than throw.
    const result = explainChartHand({
      chart: BTN_RFI,
      hand: '32o',
      registry,
      chartVersion: 'test-1',
    });

    expect(result.frequencies).toEqual([{ action: 'fold', freq: 1 }]);
    expect(result.primary).toBe('fold');
  });

  it('rejects a hand outside the 169 rather than treating it as a fold', () => {
    expect(() =>
      explainChartHand({ chart: BTN_RFI, hand: 'AJ0', registry, chartVersion: 'test-1' }),
    ).toThrow(/canonical/);
  });
});
