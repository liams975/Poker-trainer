import { describe, expect, it } from 'vitest';

import type { Combo } from '../src/cards';
import { parseCards } from '../src/cards';
import type { HandState } from '../src/game';
import { applyAction, createHandState } from '../src/game';
import type { Position, Range, RangeChart } from '../src/ranges';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, createChartRegistry } from '../src/ranges';
import { createChartStrategy, deriveActionSequence } from '../src/strategy';

/**
 * `ChartStrategy` is the join between Phase 2's charts and Phase 3a's game
 * state: it turns "who did what" into a chart key, then a distribution.
 *
 * These tests use a small synthetic registry, the same way chart-lookup.test.ts
 * does. The exit criterion — that every *seeded* chart resolves — lives in
 * packages/content/tests/strategy.test.ts, because the engine cannot import
 * packages/content.
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

const registry = createChartRegistry({
  version: 'test-3a',
  published: true,
  charts: [chart('UTG', 'rfi', OPEN), chart('BB', 'vs_btn_open', DEFEND)],
});

const strategy = createChartStrategy({ registry, chartVersion: 'test-3a' });

/** Everyone folds to hero, who is first in. */
function foldedTo(hero: Position, hole: Combo): HandState {
  let state = createHandState({ hole: { [hero]: hole } });
  while (state.toAct !== undefined && state.toAct !== hero) {
    state = applyAction(state, 'fold');
  }
  return state;
}

/** BTN opens, folds to the big blind. */
function bbFacingButton(hole: Combo): HandState {
  let state = createHandState({ hole: { BB: hole } });
  for (const position of ['UTG', 'HJ', 'CO'] as const) {
    // Asserting the turn as we go: the fold order is the action order.
    expect(state.toAct).toBe(position);
    state = applyAction(state, 'fold');
  }
  state = applyAction(state, 'raise', 2.5);
  return applyAction(state, 'fold');
}

describe('deriveActionSequence', () => {
  it('is rfi when hero is first in', () => {
    expect(deriveActionSequence(foldedTo('UTG', combo('AsKs')), 'UTG')).toBe('rfi');
    expect(deriveActionSequence(foldedTo('BTN', combo('AsKs')), 'BTN')).toBe('rfi');
  });

  it('names the opener when hero is the big blind facing one raise', () => {
    expect(deriveActionSequence(bbFacingButton(combo('KhQd')), 'BB')).toBe('vs_btn_open');
  });

  it('is undefined once somebody has limped', () => {
    // A limped pot is neither first-in nor a single-raise spot; Phase 2 seeded
    // no chart for it, so the honest answer is "no chart", not a wrong one.
    let state = createHandState({ hole: { BB: combo('KhQd') } });
    state = applyAction(state, 'call');
    for (const position of ['HJ', 'CO', 'BTN', 'SB'] as const) {
      // Asserting the turn as we go: the fold order is the action order.
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }

    expect(deriveActionSequence(state, 'BB')).toBeUndefined();
  });

  it('is undefined after a three-bet', () => {
    let state = createHandState({ hole: { BB: combo('KhQd') } });
    state = applyAction(state, 'raise', 3);
    state = applyAction(state, 'raise', 9);
    for (const position of ['CO', 'BTN', 'SB'] as const) {
      // Asserting the turn as we go: the fold order is the action order.
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }

    expect(deriveActionSequence(state, 'BB')).toBeUndefined();
  });

  it('is undefined for a non-blind seat facing an open', () => {
    // Phase 2 seeded blind defence only. CO facing a UTG open has no chart yet.
    let state = createHandState({ hole: { CO: combo('KhQd') } });
    state = applyAction(state, 'raise', 3);
    state = applyAction(state, 'fold');

    expect(deriveActionSequence(state, 'CO')).toBeUndefined();
  });

  it('is undefined against an all-in open', () => {
    // The blind-defence charts are authored against a 2.5bb open. Mapping a
    // 100bb jam onto them told the big blind to "raise to 11" — an action that
    // is not legal in that state — and to stack off 100bb with small pairs.
    let state = createHandState({ hole: { BB: combo('KhQd') } });
    state = applyAction(state, 'allin');
    for (const position of ['HJ', 'CO', 'BTN', 'SB'] as const) {
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }

    expect(state.toAct).toBe('BB');
    expect(deriveActionSequence(state, 'BB')).toBeUndefined();
  });

  it('is undefined against an open larger than the charts model', () => {
    let state = createHandState({ hole: { BB: combo('KhQd') } });
    state = applyAction(state, 'raise', 20);
    for (const position of ['HJ', 'CO', 'BTN', 'SB'] as const) {
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }

    expect(deriveActionSequence(state, 'BB')).toBeUndefined();
  });

  it('still accepts opens within the modelled band', () => {
    for (const size of [2, 2.5, 3, 4]) {
      let state = createHandState({ hole: { BB: combo('KhQd') } });
      state = applyAction(state, 'raise', size);
      for (const position of ['HJ', 'CO', 'BTN', 'SB'] as const) {
        expect(state.toAct).toBe(position);
        state = applyAction(state, 'fold');
      }

      expect(deriveActionSequence(state, 'BB')).toBe('vs_utg_open');
    }
  });

  it('is undefined postflop', () => {
    let state = createHandState({ hole: { BB: combo('KhQd') } });
    for (const position of ['UTG', 'HJ', 'CO', 'BTN'] as const) {
      // Asserting the turn as we go: the fold order is the action order.
      expect(state.toAct).toBe(position);
      state = applyAction(state, 'fold');
    }
    state = applyAction(state, 'call');
    state = applyAction(state, 'check');

    expect(state.street).toBe('flop');
    expect(deriveActionSequence(state, 'BB')).toBeUndefined();
  });
});

describe('recommend', () => {
  it('returns the chart distribution, not an answer', () => {
    const rec = strategy.recommend(foldedTo('UTG', combo('AhJs')), 'UTG');

    expect(rec.frequencies).toEqual([
      { action: 'raise', size: 2.5, freq: 0.6 },
      { action: 'fold', freq: 0.4 },
    ]);
  });

  it('names the highest-frequency action as primary, with its size', () => {
    const rec = strategy.recommend(foldedTo('UTG', combo('AhJs')), 'UTG');

    expect(rec.primary).toBe('raise');
    expect(rec.primarySize).toBe(2.5);
  });

  it('omits a size for an unsized primary action', () => {
    const rec = strategy.recommend(bbFacingButton(combo('KhQd')), 'BB');

    expect(rec.primary).toBe('call');
    expect(rec.primarySize).toBeUndefined();
  });

  it('records where the answer came from and which chart version', () => {
    const rec = strategy.recommend(foldedTo('UTG', combo('AsAh')), 'UTG');

    expect(rec.source).toBe('chart');
    expect(rec.chartVersion).toBe('test-3a');
  });

  it('gives a pure fold for a hand the chart does not list', () => {
    const rec = strategy.recommend(foldedTo('UTG', combo('7h2d')), 'UTG');

    expect(rec.frequencies).toEqual([{ action: 'fold', freq: 1 }]);
    expect(rec.primary).toBe('fold');
  });

  it('attaches a structured, non-empty rationale', () => {
    const rec = strategy.recommend(foldedTo('UTG', combo('AhJs')), 'UTG');

    expect(rec.rationale.factors.length).toBeGreaterThan(0);
    for (const f of rec.rationale.factors) {
      expect(typeof f.kind).toBe('string');
      expect(['high', 'medium', 'low']).toContain(f.weight);
      expect(Object.keys(f.detail).length).toBeGreaterThan(0);
    }
  });

  it('flags a mixed hand as mixed and a pure one as not', () => {
    const mixed = strategy.recommend(foldedTo('UTG', combo('AhJs')), 'UTG');
    const pure = strategy.recommend(foldedTo('UTG', combo('AsAh')), 'UTG');

    expect(mixed.rationale.factors.some((f) => f.kind === 'mix')).toBe(true);
    expect(pure.rationale.factors.some((f) => f.kind === 'mix')).toBe(false);
  });

  it('resolves a blind-defence spot', () => {
    const rec = strategy.recommend(bbFacingButton(combo('AsAh')), 'BB');

    expect(rec.primary).toBe('raise');
    expect(rec.primarySize).toBe(11);
  });
});

describe('honest failures', () => {
  it('throws when hero has no cards', () => {
    // UTG is to act, so the turn check passes and the missing cards are the
    // reason this fails.
    expect(() => strategy.recommend(createHandState(), 'UTG')).toThrow(/cards/i);
  });

  it('refuses to answer for a seat whose turn it is not', () => {
    // Without this, a seat that has already folded gets a confident
    // recommendation for a decision it is not making.
    const state = foldedTo('UTG', combo('AsKs'));

    expect(() => strategy.recommend(state, 'CO')).toThrow(/turn/i);
    expect(deriveActionSequence(state, 'CO')).toBeUndefined();
  });

  it('refuses a seat that has already folded', () => {
    const state = applyAction(createHandState({ hole: { UTG: combo('AsKs') } }), 'fold');

    expect(deriveActionSequence(state, 'UTG')).toBeUndefined();
    expect(() => strategy.recommend(state, 'UTG')).toThrow(/turn/i);
  });

  it('refuses a seat that has not reached its turn', () => {
    expect(deriveActionSequence(createHandState(), 'BTN')).toBeUndefined();
  });

  it('throws naming the key it looked for when no chart exists', () => {
    let state = createHandState({ hole: { CO: combo('AsKs') } });
    state = applyAction(state, 'fold');
    state = applyAction(state, 'fold');

    // CO is first in, so the sequence derives fine — there is simply no CO rfi
    // chart in this synthetic registry.
    expect(() => strategy.recommend(state, 'CO')).toThrow(/6\|100\|CO\|rfi/);
  });

  it('throws for a spot no chart family covers', () => {
    let state = createHandState({ hole: { CO: combo('AsKs') } });
    state = applyAction(state, 'raise', 3);
    state = applyAction(state, 'fold');

    expect(() => strategy.recommend(state, 'CO')).toThrow(/no chart/i);
  });

  it('refuses a table size or stack depth v1 has no charts for', () => {
    const short = createHandState({ tableSize: 5, hole: { BTN: combo('AsKs') } });

    expect(() => strategy.recommend(short, 'BTN')).toThrow(/6-max|100bb/);
  });
});
