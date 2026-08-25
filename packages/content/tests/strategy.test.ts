import { describe, expect, it } from 'vitest';

import type { Combo, FactorDetail, FactorKind, HandState, RangeChart } from '@poker/engine';
import {
  CANONICAL_HANDS,
  FACTOR_KINDS,
  applyAction,
  combosOf,
  createChartStrategy,
  createHandState,
  deriveActionSequence,
  handStrategy,
  primaryAction,
} from '@poker/engine';

import { CHART_SET_VERSION, loadChartRegistry, loadChartSet } from '../src/chart-set';

/**
 * The Phase 3a exit criterion, end to end: every *seeded* chart key resolves to
 * a well-formed recommendation from a real constructed hand state.
 *
 * It lives here rather than in packages/engine because the engine cannot import
 * packages/content — the dependency runs content → engine. Engine-side tests
 * use small synthetic registries; this is the only place the real charts and
 * the real strategy meet.
 */

const set = loadChartSet();
const strategy = createChartStrategy({
  registry: loadChartRegistry(),
  chartVersion: CHART_SET_VERSION,
});

/** A concrete two-card holding for a canonical hand. */
function someCombo(hand: string): Combo {
  return combosOf(hand)[0]!;
}

/**
 * Replays the betting that produces the spot a chart addresses, so the state is
 * built by applying real actions rather than being hand-constructed.
 */
function spotFor(chart: RangeChart, hand: string): HandState {
  const hero = chart.heroPosition;
  let state = createHandState({ hole: { [hero]: someCombo(hand) } });

  if (chart.actionSequence === 'rfi') {
    while (state.toAct !== undefined && state.toAct !== hero) {
      state = applyAction(state, 'fold');
    }
    return state;
  }

  const opener = chart.actionSequence.slice('vs_'.length, -'_open'.length).toUpperCase();
  while (state.toAct !== undefined && state.toAct !== hero) {
    state = state.toAct === opener ? applyAction(state, 'raise', 2.5) : applyAction(state, 'fold');
  }
  return state;
}

describe('every seeded chart resolves from a real hand state', () => {
  it.each(set.charts.map((c) => [`${c.heroPosition}/${c.actionSequence}`, c] as const))(
    '%s',
    (_label, chart) => {
      const state = spotFor(chart, 'AA');

      expect(state.toAct).toBe(chart.heroPosition);
      expect(deriveActionSequence(state, chart.heroPosition)).toBe(chart.actionSequence);
      expect(() => strategy.recommend(state, chart.heroPosition)).not.toThrow();
    },
  );

  it('agrees with the chart on all 169 hands, in every chart', () => {
    for (const chart of set.charts) {
      for (const hand of CANONICAL_HANDS) {
        const state = spotFor(chart, hand);
        const rec = strategy.recommend(state, chart.heroPosition);
        const expected = handStrategy(chart.ranges, hand);

        expect(rec.frequencies, `${chart.heroPosition}/${chart.actionSequence} ${hand}`).toEqual(
          expected,
        );
        expect(rec.primary).toBe(primaryAction(expected).action);
      }
    }
  });

  it('records the chart version on every recommendation', () => {
    for (const chart of set.charts) {
      const rec = strategy.recommend(spotFor(chart, 'AA'), chart.heroPosition);

      expect(rec.chartVersion).toBe(CHART_SET_VERSION);
      expect(rec.source).toBe('chart');
    }
  });
});

describe('recommendations are distributions, not answers', () => {
  it('returns the full mix for a genuinely mixed hand', () => {
    // A hand the charts actually split. If this ever became a single action,
    // the product would be teaching the thing it exists to correct.
    const chart = set.charts.find((c) => c.actionSequence === 'vs_btn_open')!;
    const mixed = CANONICAL_HANDS.filter((hand) => handStrategy(chart.ranges, hand).length > 1);

    expect(mixed.length).toBeGreaterThan(10);

    const rec = strategy.recommend(spotFor(chart, mixed[0]!), chart.heroPosition);
    expect(rec.frequencies.length).toBeGreaterThan(1);
    expect(rec.frequencies.reduce((sum, f) => sum + f.freq, 0)).toBeCloseTo(1, 6);
  });

  it('gives a pure fold for a hand outside the range, without throwing', () => {
    const utg = set.charts.find((c) => c.heroPosition === 'UTG')!;
    const rec = strategy.recommend(spotFor(utg, '72o'), 'UTG');

    expect(rec.frequencies).toEqual([{ action: 'fold', freq: 1 }]);
    expect(rec.primary).toBe('fold');
  });
});

describe('rationale renders without engine changes', () => {
  // The same renderer shape as the engine-side test, applied to real content.
  const RENDERERS: Record<FactorKind, (detail: FactorDetail) => string> = {
    position: (d) => `${d.position}, ${d.seatsBehind} left to act`,
    hand_class: (d) => `${d.hand} (${d.combos} combos)`,
    action_sequence: (d) => `spot: ${d.sequence}`,
    range_shape: (d) => `${d.rangePercent}% of hands`,
    mix: (d) => `mixed across ${d.actions} actions`,
    pot_odds: (d) => `needs ${d.requiredEquity}`,
    board_texture: (d) => `board: ${d.texture}`,
    spr: (d) => `SPR ${d.spr}`,
  };

  it('renders every factor of every recommendation, for every chart', () => {
    const seen = new Set<FactorKind>();

    for (const chart of set.charts) {
      for (const hand of ['AA', 'AJo', 'KQo', '72o']) {
        const rec = strategy.recommend(spotFor(chart, hand), chart.heroPosition);

        for (const f of rec.rationale.factors) {
          seen.add(f.kind);
          const text = RENDERERS[f.kind](f.detail);
          expect(text).toMatch(/\S/);
          expect(text).not.toMatch(/undefined/);
        }
      }
    }

    // The renderer covers the whole vocabulary even though preflop chart spots
    // only exercise part of it; the rest arrive with postflop.
    expect(Object.keys(RENDERERS).sort()).toEqual([...FACTOR_KINDS].sort());
    expect(seen.size).toBeGreaterThan(0);
  });

  it('never puts prose in a rationale detail', () => {
    for (const chart of set.charts) {
      const rec = strategy.recommend(spotFor(chart, 'AJo'), chart.heroPosition);

      for (const f of rec.rationale.factors) {
        for (const value of Object.values(f.detail)) {
          if (typeof value !== 'string') continue;
          expect(value.length).toBeLessThanOrEqual(32);
          expect(value).not.toMatch(/[.!?](\s|$)/);
        }
      }
    }
  });
});

describe('spots the seeded charts do not cover', () => {
  it('declines a limped pot rather than answering from a neighbouring chart', () => {
    let state = createHandState({ hole: { BB: someCombo('AA') } });
    state = applyAction(state, 'call');
    for (const position of ['HJ', 'CO', 'BTN', 'SB'] as const) {
      // Asserting the turn as we go: the fold order is the action order.
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }

    expect(deriveActionSequence(state, 'BB')).toBeUndefined();
    expect(() => strategy.recommend(state, 'BB')).toThrow(/no chart family/i);
  });

  it('declines a three-bet spot, which is a later data addition', () => {
    let state = createHandState({ hole: { UTG: someCombo('AA') } });
    state = applyAction(state, 'raise', 2.5);
    state = applyAction(state, 'raise', 9);
    while (state.toAct !== undefined && state.toAct !== 'UTG') {
      state = applyAction(state, 'fold');
    }

    expect(() => strategy.recommend(state, 'UTG')).toThrow(/no chart/i);
  });
});
