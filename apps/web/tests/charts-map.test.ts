import { describe, expect, it } from 'vitest';

import {
  chartFamily,
  chartId,
  chartLabel,
  toChartSet,
  type ChartSetRow,
  type RangeChartRow,
} from '../src/lib/charts/map';

/**
 * The boundary where database bytes become a chart the app will teach from.
 *
 * A range that is subtly wrong is worse than one that fails to load — the user
 * studies it and believes it — so the interesting cases here are the malformed
 * ones, and what matters is that they throw rather than render.
 */

/**
 * Only the hands that do something.
 *
 * The engine's validator rejects an explicitly listed pure fold — "omit the
 * hand rather than listing it" — because absent already means always-fold, and
 * two ways of saying the same thing is how a chart ends up half-updated. The
 * real rows in `range_charts` are shaped exactly like this.
 */
function fullRange(): Record<string, { action: string; size?: number; freq: number }[]> {
  return {
    AA: [{ action: 'raise', size: 2.5, freq: 1 }],
    KK: [{ action: 'raise', size: 2.5, freq: 1 }],
    AJo: [
      { action: 'raise', size: 2.5, freq: 0.6 },
      { action: 'fold', freq: 0.4 },
    ],
  };
}

function row(overrides: Partial<RangeChartRow> = {}): RangeChartRow {
  return {
    table_size: 6,
    stack_depth: 100,
    hero_position: 'BTN',
    action_sequence: 'rfi',
    ranges: fullRange(),
    skill_tags: ['preflop.rfi.btn'],
    ...overrides,
  };
}

function setRow(charts: RangeChartRow[] = [row()]): ChartSetRow {
  return { version: '2026.08.25-1', published: true, notes: null, range_charts: charts };
}

describe('toChartSet', () => {
  it('maps snake_case rows onto the engine shape', () => {
    const set = toChartSet(setRow());
    const chart = set.charts[0]!;

    expect(set.version).toBe('2026.08.25-1');
    expect(chart.tableSize).toBe(6);
    expect(chart.stackDepth).toBe(100);
    expect(chart.heroPosition).toBe('BTN');
    expect(chart.actionSequence).toBe('rfi');
    expect(chart.skillTags).toEqual(['preflop.rfi.btn']);
  });

  it('treats a null notes column as absent rather than as the string "null"', () => {
    expect(toChartSet(setRow()).notes).toBeUndefined();
  });

  it('defaults missing skill tags to an empty list', () => {
    expect(toChartSet(setRow([row({ skill_tags: null })])).charts[0]!.skillTags).toEqual([]);
  });

  it('rejects a distribution that does not sum to 1', () => {
    const broken = fullRange();
    broken['AA'] = [{ action: 'raise', size: 2.5, freq: 0.5 }];

    expect(() => toChartSet(setRow([row({ ranges: broken })]))).toThrow();
  });

  it('rejects a hand outside the 169', () => {
    const broken = { ...fullRange(), AJ0: [{ action: 'fold', freq: 1 }] };

    expect(() => toChartSet(setRow([row({ ranges: broken })]))).toThrow();
  });

  it('rejects an action the engine does not know', () => {
    const broken = fullRange();
    broken['AA'] = [{ action: 'shove', freq: 1 }];

    expect(() => toChartSet(setRow([row({ ranges: broken })]))).toThrow();
  });

  it('rejects a ranges column that is not an object at all', () => {
    // The jsonb column is untyped, so this is a real shape the DB can hold.
    expect(() => toChartSet(setRow([row({ ranges: 'not a range' })]))).toThrow();
    expect(() => toChartSet(setRow([row({ ranges: null })]))).toThrow();
  });

  it('rejects a position that is not one of the six', () => {
    expect(() => toChartSet(setRow([row({ hero_position: 'MP' })]))).toThrow();
  });
});

describe('labelling', () => {
  it('names the two families the way a player would say them', () => {
    expect(chartLabel(toChartSet(setRow()).charts[0]!)).toBe('BTN open');

    const defence = toChartSet(
      setRow([row({ hero_position: 'BB', action_sequence: 'vs_btn_open' })]),
    ).charts[0]!;
    expect(chartLabel(defence)).toBe('BB vs BTN open');
  });

  it('falls back to the raw sequence for a family nobody has authored yet', () => {
    const other = toChartSet(
      setRow([row({ hero_position: 'CO', action_sequence: 'vs_btn_3bet' })]),
    ).charts[0]!;

    expect(chartLabel(other)).toBe('CO · vs_btn_3bet');
    expect(chartFamily(other)).toBe('other');
  });

  it('classifies the two seeded families', () => {
    expect(chartFamily(toChartSet(setRow()).charts[0]!)).toBe('open');

    const defence = toChartSet(
      setRow([row({ hero_position: 'BB', action_sequence: 'vs_co_open' })]),
    ).charts[0]!;
    expect(chartFamily(defence)).toBe('defend');
  });

  it('gives every chart a distinct id', () => {
    const set = toChartSet(
      setRow([
        row(),
        row({ hero_position: 'CO' }),
        row({ hero_position: 'BB', action_sequence: 'vs_btn_open' }),
      ]),
    );

    const ids = set.charts.map(chartId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
