import { describe, expect, it } from 'vitest';

import { CANONICAL_HANDS } from '../src/cards';
import type { Range, RangeChart } from '../src/ranges';
import {
  STACK_DEPTH_100BB,
  TABLE_SIZE_6MAX,
  diffCharts,
  diffHandStrategy,
  handDiffOf,
} from '../src/ranges';

/**
 * Compare mode is the desktop feature docs/05-ui-ux.md says serious students
 * will tell other people about, and its whole value is that the highlighting is
 * *true*. A diff that quietly misses a change teaches that two ranges are the
 * same when they are not — which is worse than having no compare mode at all.
 *
 * So the maths lives here rather than in a component, and these tests are about
 * the properties rather than a handful of examples.
 */

function chartOf(ranges: Range, actionSequence = 'rfi'): RangeChart {
  return {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition: 'BTN',
    actionSequence,
    skillTags: [],
    ranges,
  };
}

/** Every hand folds, except those the caller overrides. */
function rangeWith(overrides: Range): Range {
  const ranges: Record<string, Range[string]> = {};
  for (const hand of CANONICAL_HANDS) {
    ranges[hand] = overrides[hand] ?? [{ action: 'fold', freq: 1 }];
  }
  return ranges;
}

describe('diffHandStrategy', () => {
  it('reports no distance between identical distributions', () => {
    const mix = [
      { action: 'raise' as const, size: 2.5, freq: 0.6 },
      { action: 'fold' as const, freq: 0.4 },
    ];

    const diff = diffHandStrategy(mix, mix);

    expect(diff.distance).toBe(0);
    expect(diff.primaryChanged).toBe(false);
    expect(diff.deltas).toEqual([]);
  });

  it('scores two disjoint pure strategies as the maximum, 1', () => {
    const diff = diffHandStrategy(
      [{ action: 'raise', size: 2.5, freq: 1 }],
      [{ action: 'fold', freq: 1 }],
    );

    expect(diff.distance).toBeCloseTo(1, 10);
    expect(diff.primaryChanged).toBe(true);
  });

  it('measures a partial shift as total variation, not as a count of changes', () => {
    // 60/40 raise-fold against 40/60. Each action moved by 0.2, and total
    // variation is half the summed absolute change: 0.2.
    const diff = diffHandStrategy(
      [
        { action: 'raise', size: 2.5, freq: 0.6 },
        { action: 'fold', freq: 0.4 },
      ],
      [
        { action: 'raise', size: 2.5, freq: 0.4 },
        { action: 'fold', freq: 0.6 },
      ],
    );

    expect(diff.distance).toBeCloseTo(0.2, 10);
    // The primary flipped from raise to fold even though the shift is small.
    expect(diff.primaryChanged).toBe(true);
  });

  it('is symmetric', () => {
    const a = [
      { action: 'raise' as const, size: 3, freq: 0.75 },
      { action: 'call' as const, freq: 0.25 },
    ];
    const b = [
      { action: 'raise' as const, size: 3, freq: 0.1 },
      { action: 'fold' as const, freq: 0.9 },
    ];

    expect(diffHandStrategy(a, b).distance).toBeCloseTo(diffHandStrategy(b, a).distance, 12);
  });

  it('treats a pure sizing change as a real difference', () => {
    // The trap this guards: keying deltas on `action` alone collapses these
    // two into "raise 100% vs raise 100%" and reports no change, when the
    // chart genuinely says to raise to a different size.
    const diff = diffHandStrategy(
      [{ action: 'raise', size: 2.5, freq: 1 }],
      [{ action: 'raise', size: 3, freq: 1 }],
    );

    expect(diff.distance).toBeCloseTo(1, 10);
    expect(diff.deltas).toHaveLength(2);
  });

  it('keeps distance within [0, 1] for arbitrary valid distributions', () => {
    const samples = [
      [{ action: 'fold' as const, freq: 1 }],
      [
        { action: 'call' as const, freq: 0.5 },
        { action: 'fold' as const, freq: 0.5 },
      ],
      [
        { action: 'raise' as const, size: 2.5, freq: 0.34 },
        { action: 'call' as const, freq: 0.33 },
        { action: 'fold' as const, freq: 0.33 },
      ],
      [{ action: 'allin' as const, freq: 1 }],
    ];

    for (const a of samples) {
      for (const b of samples) {
        const { distance } = diffHandStrategy(a, b);
        expect(distance).toBeGreaterThanOrEqual(0);
        expect(distance).toBeLessThanOrEqual(1);
      }
    }
  });

  it('signs deltas from a towards b', () => {
    const diff = diffHandStrategy(
      [
        { action: 'raise', size: 2.5, freq: 0.8 },
        { action: 'fold', freq: 0.2 },
      ],
      [
        { action: 'raise', size: 2.5, freq: 0.5 },
        { action: 'fold', freq: 0.5 },
      ],
    );

    const raise = diff.deltas.find((d) => d.action === 'raise');
    const fold = diff.deltas.find((d) => d.action === 'fold');

    expect(raise?.delta).toBeCloseTo(-0.3, 10);
    expect(fold?.delta).toBeCloseTo(0.3, 10);
  });
});

describe('diffCharts', () => {
  it('finds nothing when a chart is compared with itself', () => {
    const chart = chartOf(
      rangeWith({
        AA: [{ action: 'raise', size: 2.5, freq: 1 }],
        AKs: [
          { action: 'raise', size: 2.5, freq: 0.7 },
          { action: 'fold', freq: 0.3 },
        ],
      }),
    );

    const diff = diffCharts(chart, chart);

    expect(diff.changedCount).toBe(0);
    expect(diff.hands.every((h) => h.distance === 0)).toBe(true);
  });

  it('covers all 169 hands so the grid can index it directly', () => {
    const chart = chartOf(rangeWith({}));

    expect(diffCharts(chart, chart).hands).toHaveLength(169);
  });

  it('detects a single changed hand and leaves the rest alone', () => {
    const a = chartOf(rangeWith({ AA: [{ action: 'raise', size: 2.5, freq: 1 }] }));
    const b = chartOf(rangeWith({ AA: [{ action: 'allin', freq: 1 }] }));

    const diff = diffCharts(a, b);

    expect(diff.changedCount).toBe(1);
    expect(handDiffOf(diff, 'AA').distance).toBeCloseTo(1, 10);
    expect(handDiffOf(diff, 'KK').distance).toBe(0);
  });

  it('sees a hand present in one chart and absent from the other', () => {
    // An absent hand means "always fold" (ranges/range.ts), so this is a real
    // strategic difference and not a missing-data case to skip.
    const a = chartOf(rangeWith({ QJs: [{ action: 'raise', size: 2.5, freq: 1 }] }));
    const b = chartOf({ ...rangeWith({}), QJs: undefined } as unknown as Range);

    expect(handDiffOf(diffCharts(a, b), 'QJs').distance).toBeCloseTo(1, 10);
  });

  it('records both chart keys so the UI can label which side is which', () => {
    const a = chartOf(rangeWith({}), 'rfi');
    const b = chartOf(rangeWith({}), 'vs_btn_open');

    const diff = diffCharts(a, b);

    expect(diff.a.actionSequence).toBe('rfi');
    expect(diff.b.actionSequence).toBe('vs_btn_open');
  });
});
