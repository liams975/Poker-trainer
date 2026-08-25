import { describe, expect, it } from 'vitest';

import {
  CANONICAL_HANDS,
  STACK_DEPTH_100BB,
  TABLE_SIZE_6MAX,
  comboCount,
  frequencyOf,
  frequencySum,
  handStrategy,
  lookupChart,
  chartKeyOf,
  toWeights,
  validateChartSet,
} from '@poker/engine';
import type { RangeChart } from '@poker/engine';

import { CHART_SET_VERSION, loadChartRegistry, loadChartSet, rawChartSet } from '../src/chart-set';
import { SKILL_TAGS, isSkillTag } from '../src/skill-tags';

/**
 * Phase 2 exit criteria, from docs/02-roadmap.md:
 *
 *   "Every chart in packages/content validates against the schema and every
 *    range's frequencies sum to 1.0 (± float tolerance). Lookup by key returns
 *    the right chart. Combo counts match hand-math expectations."
 *
 * The last section goes past the schema. A chart can be perfectly well-formed
 * and still wrong — a transposed range, a position mislabelled — and only
 * domain properties catch that.
 */

const set = loadChartSet();
const registry = loadChartRegistry();

function chartsWhere(predicate: (c: RangeChart) => boolean): RangeChart[] {
  return set.charts.filter(predicate);
}

const rfiCharts = chartsWhere((c) => c.actionSequence === 'rfi');
const defenceCharts = chartsWhere((c) => c.actionSequence.startsWith('vs_'));

/** Combos of the deck this range plays rather than folds. */
function width(chart: RangeChart): number {
  return comboCount(toWeights(chart.ranges));
}

describe('exit criterion: every chart validates', () => {
  it('has no schema errors', () => {
    const result = validateChartSet(rawChartSet);

    // Report every problem, not just that there was one — the whole reason the
    // validator collects rather than throws on the first.
    const detail = result.ok ? '' : result.errors.map((e) => `${e.path}: ${e.message}`).join('\n');

    expect(detail).toBe('');
    expect(result.ok).toBe(true);
  });

  it('loads without throwing', () => {
    expect(() => loadChartSet()).not.toThrow();
  });

  it('carries a version and provenance notes', () => {
    expect(set.version).toBe(CHART_SET_VERSION);
    expect(set.version).not.toHaveLength(0);
    // The charts are approximations; that must be recorded, not implied.
    expect(set.notes ?? '').toMatch(/not solver output/i);
  });
});

describe('exit criterion: frequencies sum to 1.0', () => {
  it('holds for every listed hand in every chart', () => {
    const bad: string[] = [];

    for (const chart of set.charts) {
      for (const [hand, entries] of Object.entries(chart.ranges)) {
        const sum = frequencySum(entries);
        if (Math.abs(sum - 1) > 1e-6) {
          bad.push(`${chart.heroPosition}/${chart.actionSequence} ${hand} = ${sum}`);
        }
      }
    }

    expect(bad).toEqual([]);
  });

  it('holds for all 169 hands once unlisted hands resolve to a fold', () => {
    for (const chart of set.charts) {
      for (const hand of CANONICAL_HANDS) {
        expect(Math.abs(frequencySum(handStrategy(chart.ranges, hand)) - 1)).toBeLessThan(1e-6);
      }
    }
  });
});

describe('exit criterion: lookup by key returns the right chart', () => {
  it('seeds all ten charts', () => {
    expect(set.charts).toHaveLength(10);
    expect(registry.size).toBe(10);
  });

  it('resolves every chart by its own key', () => {
    for (const chart of set.charts) {
      expect(lookupChart(registry, chartKeyOf(chart))).toBe(chart);
    }
  });

  it('covers exactly the expected keys', () => {
    const keys = set.charts
      .map((c) => `${c.heroPosition}/${c.actionSequence}`)
      .sort();

    expect(keys).toEqual(
      [
        'BB/vs_btn_open',
        'BB/vs_co_open',
        'BB/vs_hj_open',
        'BB/vs_sb_open',
        'BB/vs_utg_open',
        'BTN/rfi',
        'CO/rfi',
        'HJ/rfi',
        'SB/rfi',
        'UTG/rfi',
      ].sort(),
    );
  });

  it('returns undefined for a key that was never seeded, not a neighbour', () => {
    // BB has no RFI chart — it is never first in.
    expect(
      lookupChart(registry, {
        tableSize: TABLE_SIZE_6MAX,
        stackDepth: STACK_DEPTH_100BB,
        heroPosition: 'BB',
        actionSequence: 'rfi',
      }),
    ).toBeUndefined();

    // 3-bet charts are deliberately not seeded yet.
    expect(
      lookupChart(registry, {
        tableSize: TABLE_SIZE_6MAX,
        stackDepth: STACK_DEPTH_100BB,
        heroPosition: 'BTN',
        actionSequence: 'vs_utg_3bet',
      }),
    ).toBeUndefined();
  });
});

describe('exit criterion: combo counts match hand-math', () => {
  it('never exceeds the 1326 possible holdings', () => {
    for (const chart of set.charts) {
      expect(width(chart)).toBeGreaterThan(0);
      expect(width(chart)).toBeLessThanOrEqual(1326);
    }
  });

  it('counts a chart that plays only aces as six combos', () => {
    const onlyAces = comboCount(toWeights({ AA: [{ action: 'raise', size: 2.5, freq: 1 }] }));

    expect(onlyAces).toBe(6);
  });

  it('splits a chart into the actions that make it up', () => {
    for (const chart of defenceCharts) {
      const played = width(chart);
      const raising = comboCount(toWeights(chart.ranges, 'raise'));
      const calling = comboCount(toWeights(chart.ranges, 'call'));

      // Defence is exactly 3-betting plus calling; nothing else is available.
      expect(raising + calling).toBeCloseTo(played, 6);
    }
  });
});

describe('domain sanity the schema cannot check', () => {
  it('widens RFI ranges monotonically from UTG to the button', () => {
    // The property that catches a transposed or mislabelled chart. A chart set
    // where UTG opens wider than the button is well-formed and badly wrong.
    const order = ['UTG', 'HJ', 'CO', 'BTN'] as const;
    const widths = order.map(
      (position) => width(rfiCharts.find((c) => c.heroPosition === position)!),
    );

    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
    }
  });

  it('keeps every RFI range inside a plausible band', () => {
    const bands: Record<string, [number, number]> = {
      UTG: [0.1, 0.2],
      HJ: [0.15, 0.25],
      CO: [0.22, 0.33],
      BTN: [0.38, 0.5],
      SB: [0.28, 0.45],
    };

    for (const chart of rfiCharts) {
      const fraction = width(chart) / 1326;
      const [low, high] = bands[chart.heroPosition]!;

      expect(fraction).toBeGreaterThan(low);
      expect(fraction).toBeLessThan(high);
    }
  });

  it('opens aces from every position and never opens seven-deuce from UTG', () => {
    for (const chart of rfiCharts) {
      expect(frequencyOf(handStrategy(chart.ranges, 'AA'), 'raise')).toBe(1);
    }

    const utg = rfiCharts.find((c) => c.heroPosition === 'UTG')!;
    expect(frequencyOf(handStrategy(utg.ranges, '72o'), 'raise')).toBe(0);
  });

  it('never calls in an unopened pot', () => {
    // RFI means first in. A call would be a limp, which these charts
    // deliberately do not model — see the SB simplification in the set notes.
    for (const chart of rfiCharts) {
      expect(comboCount(toWeights(chart.ranges, 'call'))).toBe(0);
    }
  });

  it('defends the big blind wider against later openers', () => {
    const order = ['vs_utg_open', 'vs_hj_open', 'vs_co_open', 'vs_btn_open', 'vs_sb_open'];
    const widths = order.map(
      (sequence) => width(defenceCharts.find((c) => c.actionSequence === sequence)!),
    );

    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
    }
  });

  it('three-bets and calls and folds in every defence chart', () => {
    for (const chart of defenceCharts) {
      expect(comboCount(toWeights(chart.ranges, 'raise'))).toBeGreaterThan(0);
      expect(comboCount(toWeights(chart.ranges, 'call'))).toBeGreaterThan(0);
      // Never defend everything — that would be a mistake, not a range.
      expect(width(chart)).toBeLessThan(1326 * 0.7);
    }
  });

  it('contains genuinely mixed hands, not a set of pure decisions', () => {
    // The product exists to teach that ranges are mixed. A chart set with no
    // mixed hands would pass every schema check and teach the opposite.
    for (const chart of set.charts) {
      const mixed = Object.values(chart.ranges).filter((entries) => entries.length > 1);
      expect(mixed.length).toBeGreaterThan(5);
    }
  });

  it('three-bets more often against later openers', () => {
    const utg = defenceCharts.find((c) => c.actionSequence === 'vs_utg_open')!;
    const btn = defenceCharts.find((c) => c.actionSequence === 'vs_btn_open')!;

    expect(comboCount(toWeights(btn.ranges, 'raise'))).toBeGreaterThan(
      comboCount(toWeights(utg.ranges, 'raise')),
    );
  });

  it('sizes every raise sensibly', () => {
    for (const chart of set.charts) {
      for (const entries of Object.values(chart.ranges)) {
        for (const entry of entries) {
          if (entry.action !== 'raise') continue;
          expect(entry.size).toBeGreaterThanOrEqual(2);
          expect(entry.size).toBeLessThanOrEqual(15);
        }
      }
    }
  });
});

describe('skill tags', () => {
  it('gives every chart at least one tag', () => {
    for (const chart of set.charts) {
      expect(chart.skillTags.length).toBeGreaterThan(0);
    }
  });

  it('only uses tags from the declared vocabulary', () => {
    for (const chart of set.charts) {
      for (const tag of chart.skillTags) {
        expect(isSkillTag(tag), `${tag} is not in SKILL_TAGS`).toBe(true);
      }
    }
  });

  it('declares no unused tags', () => {
    // A vocabulary that drifts ahead of the content silently breaks weak-spot
    // detection, which is the whole reason docs/04 makes it a closed list.
    const used = new Set(set.charts.flatMap((c) => [...c.skillTags]));

    expect([...SKILL_TAGS].filter((tag) => !used.has(tag))).toEqual([]);
  });

  it('tags each chart distinctly', () => {
    const tags = set.charts.flatMap((c) => [...c.skillTags]);

    expect(new Set(tags).size).toBe(tags.length);
  });
});
