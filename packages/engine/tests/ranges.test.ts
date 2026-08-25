import { describe, expect, it } from 'vitest';

import { CANONICAL_HANDS } from '../src/cards';
import type { ActionFreq, Range } from '../src/ranges';
import {
  ACTIONS,
  ALWAYS_FOLD,
  FREQ_TOLERANCE,
  foldFrequency,
  frequencyOf,
  frequencySum,
  handStrategy,
  isAction,
  primaryAction,
} from '../src/ranges';

/**
 * The governing invariant of this phase, from
 * .claude/skills/poker-domain/SKILL.md:
 *
 *   "A range maps each of the 169 hands to a frequency distribution over
 *    actions, summing to 1.0. Any code that reduces a hand to one right answer
 *    is wrong."
 *
 * So the accessor under test is `handStrategy`, which always returns a full
 * distribution — never an action. `primaryAction` exists only because
 * docs/03-poker-engine.md's ActionRecommendation needs a `primary` field for
 * display; it is not "the answer".
 */

const OPEN: ActionFreq = { action: 'raise', size: 2.5, freq: 1 };

const MIXED: readonly ActionFreq[] = [
  { action: 'raise', size: 2.5, freq: 0.6 },
  { action: 'fold', freq: 0.4 },
];

const range: Range = {
  AA: [OPEN],
  AJo: MIXED,
  '72o': [{ action: 'fold', freq: 1 }],
};

describe('the action vocabulary', () => {
  it('matches the poker_action enum in the migration exactly', () => {
    // supabase/migrations/0001_initial_schema.sql:9. These strings are written
    // into a Postgres enum column, so drift here is a runtime insert failure.
    expect([...ACTIONS]).toEqual(['fold', 'check', 'call', 'bet', 'raise', 'allin']);
  });

  it.each(['fold', 'check', 'call', 'bet', 'raise', 'allin'])('accepts %s', (value) => {
    expect(isAction(value)).toBe(true);
  });

  it.each(['Fold', 'RAISE', 'limp', '', 'three-bet'])('rejects %s', (value) => {
    expect(isAction(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isAction(undefined)).toBe(false);
    expect(isAction(null)).toBe(false);
    expect(isAction(3)).toBe(false);
  });
});

describe('handStrategy', () => {
  it('returns the listed distribution', () => {
    expect(handStrategy(range, 'AJo')).toEqual(MIXED);
  });

  it('treats an unlisted hand as a pure fold', () => {
    // The compact authoring convention: a chart lists only hands that do
    // something. The consumer must never be able to tell the difference.
    expect(handStrategy(range, 'K3o')).toEqual(ALWAYS_FOLD);
    expect(frequencySum(handStrategy(range, 'K3o'))).toBe(1);
  });

  it('treats a listed pure fold exactly like an absent hand', () => {
    // The validator rejects listed pure folds in authored charts, but `Range`
    // is a plain type and code can still build one. If these ever diverged, the
    // absent-means-fold convention would be observable.
    expect(foldFrequency(handStrategy(range, '72o'))).toBe(
      foldFrequency(handStrategy(range, 'K3o')),
    );
    expect(frequencySum(handStrategy(range, '72o'))).toBe(
      frequencySum(handStrategy(range, 'K3o')),
    );
    expect(primaryAction(handStrategy(range, '72o')).action).toBe(
      primaryAction(handStrategy(range, 'K3o')).action,
    );
  });

  it('returns a summing-to-one distribution for every one of the 169 hands', () => {
    for (const hand of CANONICAL_HANDS) {
      expect(Math.abs(frequencySum(handStrategy(range, hand)) - 1)).toBeLessThan(FREQ_TOLERANCE);
    }
  });

  it('rejects a hand that is not one of the 169', () => {
    // A typo must fail loudly rather than silently resolving to a fold, which
    // is exactly what the absent-means-fold convention would otherwise hide.
    expect(() => handStrategy(range, 'AJ0')).toThrow();
    expect(() => handStrategy(range, 'KAo')).toThrow();
    expect(() => handStrategy(range, 'AAs')).toThrow();
  });

  it('does not let a caller mutate the chart through the result', () => {
    expect(Object.isFrozen(ALWAYS_FOLD)).toBe(true);
    expect(Object.isFrozen(ALWAYS_FOLD[0])).toBe(true);
  });
});

describe('frequency helpers', () => {
  it('sums frequencies', () => {
    expect(frequencySum(MIXED)).toBeCloseTo(1, 12);
    expect(frequencySum([])).toBe(0);
  });

  it('reads the frequency of one action', () => {
    expect(frequencyOf(MIXED, 'raise')).toBeCloseTo(0.6, 12);
    expect(frequencyOf(MIXED, 'fold')).toBeCloseTo(0.4, 12);
    expect(frequencyOf(MIXED, 'call')).toBe(0);
  });

  it('sums across several entries for the same action', () => {
    // Two raise sizes are a legitimate mix, and asking "how often do we raise"
    // must count both.
    const twoSizes: readonly ActionFreq[] = [
      { action: 'raise', size: 2.5, freq: 0.5 },
      { action: 'raise', size: 6, freq: 0.2 },
      { action: 'fold', freq: 0.3 },
    ];

    expect(frequencyOf(twoSizes, 'raise')).toBeCloseTo(0.7, 12);
  });

  it('reads fold frequency, including for unlisted hands', () => {
    expect(foldFrequency(handStrategy(range, 'AJo'))).toBeCloseTo(0.4, 12);
    expect(foldFrequency(handStrategy(range, 'AA'))).toBe(0);
    expect(foldFrequency(handStrategy(range, 'K3o'))).toBe(1);
  });
});

describe('primaryAction', () => {
  it('picks the highest frequency', () => {
    expect(primaryAction(MIXED)).toEqual({ action: 'raise', size: 2.5, freq: 0.6 });
  });

  it('picks the fold when folding is the majority', () => {
    const mostlyFold: readonly ActionFreq[] = [
      { action: 'raise', size: 2.5, freq: 0.2 },
      { action: 'fold', freq: 0.8 },
    ];

    expect(primaryAction(mostlyFold).action).toBe('fold');
  });

  it('breaks an exact tie toward the more aggressive action, deterministically', () => {
    // A coin-flip hand has two equally optimal actions; Phase 3 grading must
    // treat both as optimal. This function still has to return one, and which
    // one it returns cannot vary between calls or a replayed drill would
    // display differently than it was answered.
    const tied: readonly ActionFreq[] = [
      { action: 'fold', freq: 0.5 },
      { action: 'raise', size: 2.5, freq: 0.5 },
    ];
    const reversed: readonly ActionFreq[] = [...tied].reverse();

    expect(primaryAction(tied).action).toBe('raise');
    expect(primaryAction(reversed).action).toBe('raise');
    expect(primaryAction(tied)).toEqual(primaryAction(reversed));
  });

  it('breaks a tie between two raise sizes by the larger size', () => {
    const tied: readonly ActionFreq[] = [
      { action: 'raise', size: 2.5, freq: 0.5 },
      { action: 'raise', size: 6, freq: 0.5 },
    ];

    expect(primaryAction(tied).size).toBe(6);
  });

  it('rejects an empty distribution', () => {
    expect(() => primaryAction([])).toThrow();
  });
});
