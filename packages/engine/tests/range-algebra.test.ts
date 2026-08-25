import { describe, expect, it } from 'vitest';

import { CANONICAL_HANDS, comboCountOf } from '../src/cards';
import type { HandWeights, Range } from '../src/ranges';
import {
  EMPTY_WEIGHTS,
  comboCount,
  handCount,
  intersectWeights,
  scaleWeights,
  subtractWeights,
  toWeights,
  unionWeights,
  weightOf,
} from '../src/ranges';
import { mulberry32 } from '../src/rng';

/**
 * docs/03-poker-engine.md, test plan: "Algebra laws (union/intersect
 * associativity)." Combo counts: 6 for a pair, 4 suited, 12 offsuit.
 *
 * The algebra deliberately operates on a derived weight view rather than on
 * `Range` itself. "The union of two mixed strategies" is not a real poker
 * operation, and defining it as a normalised sum would break the very laws
 * this file asserts. Union of two *ranges* — the thing players actually do —
 * is max over per-hand weights, and that is associative, commutative and
 * idempotent.
 */

function randomWeights(seed: number): HandWeights {
  const rng = mulberry32(seed);
  const weights: Record<string, number> = {};
  for (const hand of CANONICAL_HANDS) {
    // A mix of zeros, ones and genuine fractions — the interesting cases for
    // min/max are the partial overlaps.
    const roll = rng.nextInt(4);
    weights[hand] = roll === 0 ? 0 : roll === 1 ? 1 : rng.nextInt(101) / 100;
  }
  return weights;
}

const A = randomWeights(1);
const B = randomWeights(2);
const C = randomWeights(3);

const FULL: HandWeights = Object.fromEntries(CANONICAL_HANDS.map((h) => [h, 1]));

describe('toWeights', () => {
  const range: Range = {
    AA: [{ action: 'raise', size: 2.5, freq: 1 }],
    AJo: [
      { action: 'raise', size: 2.5, freq: 0.6 },
      { action: 'fold', freq: 0.4 },
    ],
    KQo: [
      { action: 'call', freq: 0.7 },
      { action: 'fold', freq: 0.3 },
    ],
  };

  it('defaults to how often the hand is played rather than folded', () => {
    expect(weightOf(toWeights(range), 'AA')).toBe(1);
    expect(weightOf(toWeights(range), 'AJo')).toBeCloseTo(0.6, 12);
    expect(weightOf(toWeights(range), 'KQo')).toBeCloseTo(0.7, 12);
    expect(weightOf(toWeights(range), '72o')).toBe(0);
  });

  it('can select a single action instead', () => {
    const raising = toWeights(range, 'raise');

    expect(weightOf(raising, 'AA')).toBe(1);
    expect(weightOf(raising, 'AJo')).toBeCloseTo(0.6, 12);
    // KQo is played, but never by raising.
    expect(weightOf(raising, 'KQo')).toBe(0);
  });

  it('covers all 169 hands so the algebra is total', () => {
    const weights = toWeights(range);

    expect(Object.keys(weights)).toHaveLength(169);
    for (const hand of CANONICAL_HANDS) {
      expect(typeof weightOf(weights, hand)).toBe('number');
    }
  });
});

describe('algebra laws', () => {
  it('union and intersect are commutative', () => {
    expect(unionWeights(A, B)).toEqual(unionWeights(B, A));
    expect(intersectWeights(A, B)).toEqual(intersectWeights(B, A));
  });

  it('union and intersect are associative', () => {
    expect(unionWeights(unionWeights(A, B), C)).toEqual(unionWeights(A, unionWeights(B, C)));
    expect(intersectWeights(intersectWeights(A, B), C)).toEqual(
      intersectWeights(A, intersectWeights(B, C)),
    );
  });

  it('union and intersect are idempotent', () => {
    expect(unionWeights(A, A)).toEqual(A);
    expect(intersectWeights(A, A)).toEqual(A);
  });

  it('has the empty and full ranges as identities', () => {
    expect(unionWeights(A, EMPTY_WEIGHTS)).toEqual(A);
    expect(intersectWeights(A, FULL)).toEqual(A);
  });

  it('absorbs into empty and full', () => {
    expect(intersectWeights(A, EMPTY_WEIGHTS)).toEqual(EMPTY_WEIGHTS);
    expect(unionWeights(A, FULL)).toEqual(FULL);
  });

  it('distributes', () => {
    expect(intersectWeights(A, unionWeights(B, C))).toEqual(
      unionWeights(intersectWeights(A, B), intersectWeights(A, C)),
    );
  });
});

describe('subtract', () => {
  it('removes a range from itself entirely', () => {
    expect(subtractWeights(A, A)).toEqual(EMPTY_WEIGHTS);
  });

  it('clamps at zero rather than going negative', () => {
    const small = scaleWeights(FULL, 0.25);
    const result = subtractWeights(small, FULL);

    for (const hand of CANONICAL_HANDS) {
      expect(weightOf(result, hand)).toBe(0);
    }
  });

  it('leaves a range untouched when subtracting nothing', () => {
    expect(subtractWeights(A, EMPTY_WEIGHTS)).toEqual(A);
  });

  it('subtracts partial weight', () => {
    const half = scaleWeights(FULL, 0.5);
    const quarter = scaleWeights(FULL, 0.25);

    expect(weightOf(subtractWeights(half, quarter), 'AA')).toBeCloseTo(0.25, 12);
  });
});

describe('scale', () => {
  it('scales every weight', () => {
    expect(weightOf(scaleWeights(FULL, 0.3), 'AA')).toBeCloseTo(0.3, 12);
  });

  it('clamps above one', () => {
    expect(weightOf(scaleWeights(FULL, 5), 'AA')).toBe(1);
  });

  it('rejects a negative factor', () => {
    expect(() => scaleWeights(FULL, -1)).toThrow(RangeError);
  });
});

describe('combo counting', () => {
  it('counts the whole deck for a full range', () => {
    // C(52,2) = 1326, which is also 13*6 + 78*4 + 78*12.
    expect(comboCount(FULL)).toBe(1326);
  });

  it('counts nothing for an empty range', () => {
    expect(comboCount(EMPTY_WEIGHTS)).toBe(0);
  });

  it.each([
    ['AA', 6],
    ['AKs', 4],
    ['AKo', 12],
  ])('counts %s as %i combos', (hand, expected) => {
    const only: HandWeights = { ...EMPTY_WEIGHTS, [hand]: 1 };

    expect(comboCount(only)).toBe(expected);
    // And agrees with the already-tested per-hand count in cards/notation.
    expect(comboCount(only)).toBe(comboCountOf(hand));
  });

  it('counts partial weight proportionally', () => {
    const half: HandWeights = { ...EMPTY_WEIGHTS, AA: 0.5, AKo: 0.25 };

    expect(comboCount(half)).toBeCloseTo(6 * 0.5 + 12 * 0.25, 12);
  });

  it('counts a pocket pairs range as 78 combos', () => {
    const pairs: HandWeights = { ...EMPTY_WEIGHTS };
    for (const hand of CANONICAL_HANDS) {
      if (hand.length === 2) (pairs as Record<string, number>)[hand] = 1;
    }

    expect(comboCount(pairs)).toBe(13 * 6);
  });

  it('reports how many hands are in a range at all', () => {
    expect(handCount(FULL)).toBe(169);
    expect(handCount(EMPTY_WEIGHTS)).toBe(0);
    expect(handCount({ ...EMPTY_WEIGHTS, AA: 0.01 })).toBe(1);
  });
});

describe('immutability', () => {
  it('does not mutate its operands', () => {
    const before = { ...A };
    unionWeights(A, B);
    intersectWeights(A, B);
    subtractWeights(A, B);
    scaleWeights(A, 0.5);

    expect(A).toEqual(before);
  });
});
