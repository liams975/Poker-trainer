import { describe, expect, it } from 'vitest';

import type { ActionFreq } from '../src/ranges';
import { ACCEPTABLE_THRESHOLD, GRADE_TIERS, gradeAnswer } from '../src/drills';

/**
 * docs/03-poker-engine.md, and the roadmap's Phase 3 exit criterion:
 *
 *   "Grading correctly handles mixed strategies: a 70/30 raise/fold hand grades
 *    a fold as *acceptable*, not wrong."
 *
 * This is the file where a naive implementation gets it wrong. Ranges are mixed,
 * so grading is not binary — and the boundaries are exact, not approximate:
 * 0.15 is acceptable, and zero is a blunder rather than merely inaccurate.
 */

const OPEN_70_30: readonly ActionFreq[] = [
  { action: 'raise', size: 2.5, freq: 0.7 },
  { action: 'fold', freq: 0.3 },
];

const POT = 4;

describe('the tier vocabulary', () => {
  it('matches the grade_tier enum, in order of quality', () => {
    // supabase/migrations/0001_initial_schema.sql:11
    expect([...GRADE_TIERS]).toEqual(['optimal', 'acceptable', 'inaccurate', 'blunder']);
  });

  it('puts the acceptable threshold at fifteen percent', () => {
    expect(ACCEPTABLE_THRESHOLD).toBe(0.15);
  });
});

describe('the exit criterion: a 70/30 hand', () => {
  it('grades the raise optimal', () => {
    expect(gradeAnswer(OPEN_70_30, { action: 'raise', size: 2.5 }, POT).tier).toBe('optimal');
  });

  it('grades the fold acceptable, not wrong', () => {
    // The whole point. Telling someone this hand "is a raise" when it folds 30%
    // of the time actively makes them a worse player.
    const grade = gradeAnswer(OPEN_70_30, { action: 'fold' }, POT);

    expect(grade.tier).toBe('acceptable');
    expect(grade.frequency).toBeCloseTo(0.3, 10);
  });

  it('grades an action the chart never takes a blunder', () => {
    expect(gradeAnswer(OPEN_70_30, { action: 'call' }, POT).tier).toBe('blunder');
  });

  it('always reports the full distribution back', () => {
    expect(gradeAnswer(OPEN_70_30, { action: 'fold' }, POT).frequencies).toEqual(OPEN_70_30);
  });
});

describe('tier boundaries, exactly', () => {
  function atFrequency(freq: number): readonly ActionFreq[] {
    return [
      { action: 'call', freq },
      { action: 'fold', freq: 1 - freq },
    ];
  }

  it('treats exactly 0.15 as acceptable', () => {
    expect(gradeAnswer(atFrequency(0.15), { action: 'call' }, POT).tier).toBe('acceptable');
  });

  it('treats just under 0.15 as inaccurate', () => {
    // 0.1499, not 0.14: the boundary is meant to be exact, so the test has to
    // sit hard against it rather than somewhere comfortably below.
    expect(gradeAnswer(atFrequency(0.1499), { action: 'call' }, POT).tier).toBe('inaccurate');
    expect(gradeAnswer(atFrequency(0.14), { action: 'call' }, POT).tier).toBe('inaccurate');
  });

  it('treats exactly zero as a blunder, not merely inaccurate', () => {
    const grade = gradeAnswer(atFrequency(0), { action: 'call' }, POT);

    expect(grade.tier).toBe('blunder');
    expect(grade.frequency).toBe(0);
  });

  it('treats a hand absent from the chart as a blunder to raise', () => {
    const pureFold: readonly ActionFreq[] = [{ action: 'fold', freq: 1 }];

    expect(gradeAnswer(pureFold, { action: 'raise', size: 2.5 }, POT).tier).toBe('blunder');
    expect(gradeAnswer(pureFold, { action: 'fold' }, POT).tier).toBe('optimal');
  });
});

describe('ties', () => {
  const COIN_FLIP: readonly ActionFreq[] = [
    { action: 'raise', size: 2.5, freq: 0.5 },
    { action: 'fold', freq: 0.5 },
  ];

  it('grades both actions of a 50/50 hand optimal', () => {
    // A genuine coin-flip hand has two optimal actions. Comparing against a
    // deterministic tiebreak would wrongly demote one of them to acceptable.
    expect(gradeAnswer(COIN_FLIP, { action: 'raise', size: 2.5 }, POT).tier).toBe('optimal');
    expect(gradeAnswer(COIN_FLIP, { action: 'fold' }, POT).tier).toBe('optimal');
  });

  it('costs nothing either way', () => {
    expect(gradeAnswer(COIN_FLIP, { action: 'fold' }, POT).evLoss).toBe(0);
  });
});

describe('frequency sums across sizes', () => {
  const TWO_SIZES: readonly ActionFreq[] = [
    { action: 'raise', size: 2.5, freq: 0.45 },
    { action: 'raise', size: 6, freq: 0.25 },
    { action: 'fold', freq: 0.3 },
  ];

  it('counts every raise size toward raising', () => {
    // 0.45 + 0.25 = 0.70, which beats the 0.30 fold.
    const grade = gradeAnswer(TWO_SIZES, { action: 'raise', size: 2.5 }, POT);

    expect(grade.frequency).toBeCloseTo(0.7, 10);
    expect(grade.tier).toBe('optimal');
  });

  it('grades the smaller raise size optimal too, since the action is what is graded', () => {
    expect(gradeAnswer(TWO_SIZES, { action: 'raise', size: 6 }, POT).tier).toBe('optimal');
  });
});

describe('sizing', () => {
  it('does not demote a correct action for a wrong size', () => {
    // The decision recorded in the plan: a correct read is never a blunder for
    // sizing. Sizing is taught through the mismatch and a small EV term.
    const grade = gradeAnswer(OPEN_70_30, { action: 'raise', size: 5 }, POT);

    expect(grade.tier).toBe('optimal');
    expect(grade.sizeMismatch).toEqual({ chose: 5, expected: 2.5 });
  });

  it('reports no mismatch when the size is right', () => {
    expect(gradeAnswer(OPEN_70_30, { action: 'raise', size: 2.5 }, POT).sizeMismatch).toBeUndefined();
  });

  it('charges a small EV cost for the wrong size', () => {
    const right = gradeAnswer(OPEN_70_30, { action: 'raise', size: 2.5 }, POT);
    const wrong = gradeAnswer(OPEN_70_30, { action: 'raise', size: 5 }, POT);

    expect(right.evLoss).toBe(0);
    expect(wrong.evLoss).toBeGreaterThan(0);
    // Still far cheaper than picking the wrong action entirely.
    expect(wrong.evLoss).toBeLessThan(gradeAnswer(OPEN_70_30, { action: 'call' }, POT).evLoss);
  });

  it('accepts any listed size without a mismatch', () => {
    const twoSizes: readonly ActionFreq[] = [
      { action: 'raise', size: 2.5, freq: 0.45 },
      { action: 'raise', size: 6, freq: 0.25 },
      { action: 'fold', freq: 0.3 },
    ];

    expect(gradeAnswer(twoSizes, { action: 'raise', size: 6 }, POT).sizeMismatch).toBeUndefined();
  });

  it('reports no mismatch for an action the chart never takes', () => {
    // There is no expected size to compare against; the blunder is the story.
    expect(gradeAnswer(OPEN_70_30, { action: 'bet', size: 3 }, POT).sizeMismatch).toBeUndefined();
  });
});

describe('EV loss', () => {
  it('is zero for an optimal answer', () => {
    expect(gradeAnswer(OPEN_70_30, { action: 'raise', size: 2.5 }, POT).evLoss).toBe(0);
  });

  it('orders the tiers', () => {
    const spread: readonly ActionFreq[] = [
      { action: 'raise', size: 2.5, freq: 0.6 },
      { action: 'call', freq: 0.3 },
      { action: 'check', freq: 0.1 },
    ];

    const optimal = gradeAnswer(spread, { action: 'raise', size: 2.5 }, POT).evLoss;
    const acceptable = gradeAnswer(spread, { action: 'call' }, POT).evLoss;
    const inaccurate = gradeAnswer(spread, { action: 'check' }, POT).evLoss;
    const blunder = gradeAnswer(spread, { action: 'fold' }, POT).evLoss;

    expect(optimal).toBeLessThan(acceptable);
    expect(acceptable).toBeLessThan(inaccurate);
    expect(inaccurate).toBeLessThan(blunder);
  });

  it('costs more in a bigger pot', () => {
    // docs/03: "A blunder in a big pot should cost more than a marginal
    // frequency error."
    const small = gradeAnswer(OPEN_70_30, { action: 'call' }, 1.5).evLoss;
    const big = gradeAnswer(OPEN_70_30, { action: 'call' }, 12).evLoss;

    expect(big).toBeGreaterThan(small);
    expect(big / small).toBeCloseTo(8, 6);
  });

  it('is the frequency gap times the pot', () => {
    expect(gradeAnswer(OPEN_70_30, { action: 'fold' }, 10).evLoss).toBeCloseTo(4, 6);
  });

  it('fits the numeric(8,4) column it is stored in', () => {
    const grade = gradeAnswer(OPEN_70_30, { action: 'call' }, 600);

    expect(grade.evLoss).toBeGreaterThanOrEqual(0);
    expect(grade.evLoss).toBeLessThan(10000);
    expect(Number(grade.evLoss.toFixed(4))).toBe(grade.evLoss);
  });

  it('is never negative', () => {
    for (const action of ['raise', 'fold', 'call', 'check'] as const) {
      const answer = action === 'raise' ? { action, size: 2.5 } : { action };
      expect(gradeAnswer(OPEN_70_30, answer, POT).evLoss).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('invalid input', () => {
  it('rejects a size on an action that cannot carry one', () => {
    expect(() => gradeAnswer(OPEN_70_30, { action: 'fold', size: 2 }, POT)).toThrow(RangeError);
  });

  it('rejects a missing size on a raise', () => {
    expect(() => gradeAnswer(OPEN_70_30, { action: 'raise' }, POT)).toThrow(RangeError);
  });

  it('rejects a non-positive pot', () => {
    expect(() => gradeAnswer(OPEN_70_30, { action: 'fold' }, 0)).toThrow(RangeError);
    expect(() => gradeAnswer(OPEN_70_30, { action: 'fold' }, -1)).toThrow(RangeError);
  });

  it('rejects an empty distribution', () => {
    expect(() => gradeAnswer([], { action: 'fold' }, POT)).toThrow(RangeError);
  });

  it('rejects a distribution that does not sum to one', () => {
    const broken: readonly ActionFreq[] = [{ action: 'raise', size: 2.5, freq: 0.6 }];

    expect(() => gradeAnswer(broken, { action: 'fold' }, POT)).toThrow(RangeError);
  });
});

describe('a malformed distribution is rejected, not absorbed', () => {
  // The sum guard has to be checked for finiteness separately, because NaN
  // *defeats* the comparison instead of failing it: `Math.abs(NaN - 1) > tol`
  // is false. Left open, a NaN frequency graded to `evLoss: NaN`, which
  // JSON-serialises to null into a `numeric(8,4)` column.
  it.each([Number.NaN, Infinity, -Infinity])('rejects a frequency of %s', (freq) => {
    const broken: readonly ActionFreq[] = [
      { action: 'raise', size: 2.5, freq },
      { action: 'fold', freq: 0.5 },
    ];

    expect(() => gradeAnswer(broken, { action: 'fold' }, POT)).toThrow(RangeError);
  });

  it('never returns a non-finite evLoss', () => {
    const grade = gradeAnswer(
      [
        { action: 'raise', size: 2.5, freq: 0.5 },
        { action: 'fold', freq: 0.5 },
      ],
      { action: 'fold' },
      POT,
    );

    expect(Number.isFinite(grade.evLoss)).toBe(true);
  });
});
