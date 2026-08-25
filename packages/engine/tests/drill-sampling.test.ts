import { describe, expect, it } from 'vitest';

import { CANONICAL_HANDS, comboCountOf } from '../src/cards';
import type { ActionFreq, Range } from '../src/ranges';
import { DEFAULT_UNIFORM_SHARE, actionEntropy, sampleHand, samplingWeights } from '../src/drills';
import { mulberry32 } from '../src/rng';

/**
 * docs/03-poker-engine.md: "Sample hands non-uniformly. Uniform sampling over
 * 169 hands wastes the user's time on trivial folds (`72o` from UTG) and rarely
 * surfaces the genuinely instructive marginal spots... This one choice does
 * more for learning velocity than any amount of UI polish."
 *
 * And the counterweight, from the same paragraph: "Reserve some uniform
 * sampling so the user still sees the full distribution of real spots and
 * doesn't learn a distorted prior."
 */

const OPEN: Range = {
  AA: [{ action: 'raise', size: 2.5, freq: 1 }],
  KK: [{ action: 'raise', size: 2.5, freq: 1 }],
  AJo: [
    { action: 'raise', size: 2.5, freq: 0.6 },
    { action: 'fold', freq: 0.4 },
  ],
  KQo: [
    { action: 'raise', size: 2.5, freq: 0.5 },
    { action: 'fold', freq: 0.5 },
  ],
};

const ALL_PURE: Range = {
  AA: [{ action: 'raise', size: 2.5, freq: 1 }],
  KK: [{ action: 'raise', size: 2.5, freq: 1 }],
};

function sum(distribution: Record<string, number>): number {
  return Object.values(distribution).reduce((total, p) => total + p, 0);
}

describe('actionEntropy', () => {
  it('is zero for a pure action', () => {
    expect(actionEntropy([{ action: 'fold', freq: 1 }])).toBe(0);
    expect(actionEntropy([{ action: 'raise', size: 2.5, freq: 1 }])).toBe(0);
  });

  it('is one bit for a coin flip', () => {
    expect(
      actionEntropy([
        { action: 'raise', size: 2.5, freq: 0.5 },
        { action: 'fold', freq: 0.5 },
      ]),
    ).toBeCloseTo(1, 10);
  });

  it('rises as a hand gets more genuinely mixed', () => {
    const lopsided: readonly ActionFreq[] = [
      { action: 'raise', size: 2.5, freq: 0.9 },
      { action: 'fold', freq: 0.1 },
    ];
    const even: readonly ActionFreq[] = [
      { action: 'raise', size: 2.5, freq: 0.5 },
      { action: 'fold', freq: 0.5 },
    ];

    expect(actionEntropy(even)).toBeGreaterThan(actionEntropy(lopsided));
  });

  it('separates a three-way mix from a two-way one', () => {
    // The reason entropy is used rather than `1 - maxFrequency`, which cannot
    // tell these apart — they are different teaching moments.
    const twoWay: readonly ActionFreq[] = [
      { action: 'raise', size: 2.5, freq: 0.6 },
      { action: 'fold', freq: 0.4 },
    ];
    const threeWay: readonly ActionFreq[] = [
      { action: 'raise', size: 2.5, freq: 0.6 },
      { action: 'call', freq: 0.2 },
      { action: 'fold', freq: 0.2 },
    ];

    expect(actionEntropy(twoWay)).toBeCloseTo(0.971, 3);
    expect(actionEntropy(threeWay)).toBeCloseTo(1.371, 3);
    expect(actionEntropy(threeWay)).toBeGreaterThan(actionEntropy(twoWay));
  });
});

describe('samplingWeights', () => {
  it('is a probability distribution', () => {
    expect(sum(samplingWeights(OPEN))).toBeCloseTo(1, 10);
  });

  it('covers all 169 hands by default', () => {
    expect(Object.keys(samplingWeights(OPEN))).toHaveLength(169);
  });

  it('defaults to reserving 30% for realistic frequencies', () => {
    expect(DEFAULT_UNIFORM_SHARE).toBe(0.3);
  });

  it('favours a mixed hand over a pure one', () => {
    // The whole point: AJo teaches something, AA does not.
    const weights = samplingWeights(OPEN);

    expect(weights.AJo!).toBeGreaterThan(weights.AA!);
  });

  it('favours the more evenly mixed of two mixed hands', () => {
    const weights = samplingWeights(OPEN);

    // KQo is 50/50, AJo is 60/40, and both are offsuit so combos are equal.
    expect(weights.KQo!).toBeGreaterThan(weights.AJo!);
  });

  it('still gives every hand a chance at the default share', () => {
    const weights = samplingWeights(OPEN);

    for (const hand of CANONICAL_HANDS) {
      expect(weights[hand]!, hand).toBeGreaterThan(0);
    }
  });

  it('is purely combo-proportional when the realistic share is one', () => {
    const weights = samplingWeights(OPEN, { uniformShare: 1 });

    // 1326 combos in total, so AKo's share is 12/1326.
    expect(weights.AKo!).toBeCloseTo(12 / 1326, 10);
    expect(weights.AKs!).toBeCloseTo(4 / 1326, 10);
    expect(weights.AKo! / weights.AKs!).toBeCloseTo(3, 10);
  });

  it('is purely boundary-driven when the realistic share is zero', () => {
    const weights = samplingWeights(OPEN, { uniformShare: 0 });

    expect(weights.AA).toBe(0);
    expect(weights['72o']).toBe(0);
    expect(weights.KQo!).toBeGreaterThan(0);
  });

  it('falls back to realistic when no hand is mixed at all', () => {
    // Otherwise the boundary component sums to zero and every weight is NaN.
    const weights = samplingWeights(ALL_PURE, { uniformShare: 0 });

    expect(sum(weights)).toBeCloseTo(1, 10);
    for (const value of Object.values(weights)) expect(Number.isFinite(value)).toBe(true);
    expect(weights.AKo!).toBeCloseTo(12 / 1326, 10);
  });

  it('honours an explicit hand list', () => {
    const weights = samplingWeights(OPEN, { include: ['AA', 'AJo', 'KQo'] });

    expect(Object.keys(weights).sort()).toEqual(['AA', 'AJo', 'KQo']);
    expect(sum(weights)).toBeCloseTo(1, 10);
  });

  it.each([-0.1, 1.1, Number.NaN])('rejects a realistic share of %s', (uniformShare) => {
    expect(() => samplingWeights(OPEN, { uniformShare })).toThrow(RangeError);
  });

  it('rejects a hand outside the 169', () => {
    expect(() => samplingWeights(OPEN, { include: ['AJ0'] })).toThrow();
  });

  it('rejects an empty hand list', () => {
    expect(() => samplingWeights(OPEN, { include: [] })).toThrow(RangeError);
  });
});

describe('sampleHand', () => {
  it('is deterministic under seed', () => {
    const weights = samplingWeights(OPEN);
    const a = Array.from({ length: 50 }, () => sampleHand(mulberry32(9), weights));

    expect(new Set(a).size).toBe(1);
  });

  it('produces the same sequence from the same seed', () => {
    const weights = samplingWeights(OPEN);
    const draw = (seed: number) => {
      const rng = mulberry32(seed);
      return Array.from({ length: 200 }, () => sampleHand(rng, weights));
    };

    expect(draw(4)).toEqual(draw(4));
    expect(draw(4)).not.toEqual(draw(5));
  });

  it('never draws a hand with zero weight', () => {
    const weights = samplingWeights(OPEN, { uniformShare: 0 });
    const rng = mulberry32(11);

    for (let i = 0; i < 2_000; i++) {
      expect(weights[sampleHand(rng, weights)]!).toBeGreaterThan(0);
    }
  });

  it('follows the distribution it is given', () => {
    const weights = samplingWeights(OPEN, { include: ['AA', 'KQo'] });
    const rng = mulberry32(2024);
    const counts = new Map<string, number>();
    const draws = 20_000;

    for (let i = 0; i < draws; i++) {
      const hand = sampleHand(rng, weights);
      counts.set(hand, (counts.get(hand) ?? 0) + 1);
    }

    for (const [hand, count] of counts) {
      expect(Math.abs(count / draws - weights[hand]!)).toBeLessThan(0.02);
    }
  });

  it('concentrates draws on mixed hands', () => {
    // The property the whole design exists for, stated as a measurement: mixed
    // hands are 2 of the 4 listed and 24 of 1326 combos, so a realistic draw
    // would surface them about 1.8% of the time.
    const weights = samplingWeights(OPEN);
    const rng = mulberry32(77);
    const mixed = new Set(['AJo', 'KQo']);
    let hits = 0;

    for (let i = 0; i < 20_000; i++) {
      if (mixed.has(sampleHand(rng, weights))) hits += 1;
    }

    const realisticShare = [...mixed].reduce((n, h) => n + comboCountOf(h), 0) / 1326;
    expect(realisticShare).toBeCloseTo(0.0181, 3);
    expect(hits / 20_000).toBeGreaterThan(realisticShare * 10);
  });
});
