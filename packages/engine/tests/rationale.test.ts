import { describe, expect, it } from 'vitest';

import type { FactorDetail, FactorKind } from '../src/strategy';
import { FACTOR_KINDS, FACTOR_WEIGHTS, factor, isFactorKind, rationale } from '../src/strategy';

/**
 * Phase 3a exit criterion: "Rationale objects render without engine changes."
 *
 * docs/03-poker-engine.md is emphatic about why: "`Rationale` must be
 * structured data, not a string... Structured rationale lets the UI render it
 * as chips, highlights, or verbose prose depending on Study vs Drill mode —
 * without engine changes. Prose strings lock you into one presentation and
 * can't be styled or filtered."
 *
 * So the criterion is tested by building a renderer *here, in the test*, and
 * asserting it covers every kind. The `Record<FactorKind, ...>` type makes an
 * uncovered kind a compile error, not a runtime surprise. If the engine ever
 * has to change for the UI to render a factor, this file is what breaks.
 */

const RENDERERS: Record<FactorKind, (detail: FactorDetail) => string> = {
  position: (d) => `Position: ${d.position}`,
  hand_class: (d) => `${d.hand} — ${d.combos} combos`,
  action_sequence: (d) => `Spot: ${d.sequence}`,
  range_shape: (d) => `Range: ${d.rangePercent}% of hands`,
  mix: (d) => `Mixed across ${d.actions} actions`,
  pot_odds: (d) => `Needs ${d.requiredEquity}% equity`,
  board_texture: (d) => `Board: ${d.texture}`,
  spr: (d) => `SPR ${d.spr}`,
};

describe('the factor vocabulary', () => {
  it('is closed', () => {
    expect(FACTOR_KINDS.length).toBeGreaterThan(0);
    expect(new Set(FACTOR_KINDS).size).toBe(FACTOR_KINDS.length);
  });

  it('weights are ordered high to low', () => {
    expect([...FACTOR_WEIGHTS]).toEqual(['high', 'medium', 'low']);
  });

  it.each([...FACTOR_KINDS])('accepts %s', (kind) => {
    expect(isFactorKind(kind)).toBe(true);
  });

  it.each(['Position', 'positional', '', 'prose'])('rejects %s', (kind) => {
    expect(isFactorKind(kind)).toBe(false);
  });
});

describe('rendering without engine changes', () => {
  it('has a renderer for every factor kind', () => {
    // The type already proves this at compile time; asserting it at runtime
    // means a kind added without a renderer fails loudly in CI too.
    for (const kind of FACTOR_KINDS) {
      expect(typeof RENDERERS[kind]).toBe('function');
    }
    expect(Object.keys(RENDERERS).sort()).toEqual([...FACTOR_KINDS].sort());
  });

  it('renders a whole rationale to display text', () => {
    const built = rationale([
      factor('position', 'high', { position: 'UTG', seatsBehind: 5 }),
      factor('hand_class', 'high', { hand: 'AJo', combos: 12 }),
      factor('mix', 'medium', { actions: 2, topFrequency: 0.6 }),
    ]);

    const lines = built.factors.map((f) => RENDERERS[f.kind](f.detail));

    expect(lines).toEqual([
      'Position: UTG',
      'AJo — 12 combos',
      'Mixed across 2 actions',
    ]);
  });
});

describe('details are facts, not prose', () => {
  it('accepts short structured values', () => {
    expect(() => factor('position', 'high', { position: 'UTG', seatsBehind: 5 })).not.toThrow();
    expect(() => factor('action_sequence', 'low', { sequence: 'vs_btn_open' })).not.toThrow();
  });

  it('rejects a sentence', () => {
    // The guard that keeps presentation out of the engine. A prose string here
    // would lock the UI into one rendering and could not be styled or filtered.
    expect(() =>
      factor('position', 'high', {
        position: 'You are under the gun, so open a tight range.',
      }),
    ).toThrow(RangeError);
  });

  it('rejects a value that merely ends like a sentence', () => {
    expect(() => factor('position', 'high', { note: 'open tight.' })).toThrow(RangeError);
  });

  it('rejects a short sentence that fits inside the length cap', () => {
    // 29 characters, so the cap alone let it through. A fact is a token or a
    // short label, never a clause.
    expect(() => factor('position', 'high', { note: 'open tight from under the gun' })).toThrow(
      RangeError,
    );
    expect(() => factor('position', 'high', { note: 'you should just fold' })).toThrow(RangeError);
  });

  it('rejects whitespace and control characters', () => {
    expect(() => factor('position', 'high', { position: '   ' })).toThrow(RangeError);
    expect(() => factor('position', 'high', { position: 'a\nb' })).toThrow(RangeError);
  });

  it('still accepts a short multi-word label', () => {
    expect(() => factor('hand_class', 'low', { shape: 'suited connector' })).not.toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => factor('position', 'high', { position: '' })).toThrow(RangeError);
  });

  it('rejects a non-finite number', () => {
    expect(() => factor('spr', 'low', { spr: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => factor('spr', 'low', { spr: Number.NaN })).toThrow(RangeError);
  });

  it('rejects an unknown kind', () => {
    expect(() => factor('vibes' as FactorKind, 'low', { x: 1 })).toThrow(RangeError);
  });

  it('rejects an unknown weight', () => {
    expect(() => factor('position', 'critical' as never, { position: 'UTG' })).toThrow(RangeError);
  });

  it('rejects a factor with no detail at all', () => {
    expect(() => factor('position', 'high', {})).toThrow(RangeError);
  });
});

describe('rationale', () => {
  it('rejects an empty factor list', () => {
    // An empty rationale renders as nothing, which teaches nothing.
    expect(() => rationale([])).toThrow(RangeError);
  });

  it('is frozen so a consumer cannot edit the explanation', () => {
    const built = rationale([factor('position', 'high', { position: 'UTG' })]);

    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.factors)).toBe(true);
  });
});
