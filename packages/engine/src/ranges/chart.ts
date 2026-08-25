/**
 * Chart addressing.
 *
 * A chart is identified by `(tableSize, stackDepth, heroPosition,
 * actionSequence)`. The unique constraint on `range_charts` in
 * supabase/migrations/0001_initial_schema.sql is those four columns plus
 * `chart_set_id`; since a registry is built from exactly one set, the fifth is
 * constant and the two reduce to the same thing. A set that builds a registry
 * here will insert there.
 *
 * `tableSize` and `stackDepth` are in the key even though v1 only ever uses 6
 * and 100. docs/03-poker-engine.md is explicit about why: adding them later
 * would touch every call site.
 *
 * `Position` lives in this file because `ChartKey` is its first consumer. It
 * belongs to the `game` module in the docs/03 module map; when Phase 3 builds
 * that, it should import from here rather than declare a second copy.
 */

import type { Range } from './range';

/** The `position_6max` enum, in seat order. UTG acts first preflop, BB last. */
export const POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;

export type Position = (typeof POSITIONS)[number];

export function isPosition(value: unknown): value is Position {
  return typeof value === 'string' && (POSITIONS as readonly string[]).includes(value);
}

export const TABLE_SIZE_6MAX = 6;
export const STACK_DEPTH_100BB = 100;

export interface ChartKey {
  tableSize: typeof TABLE_SIZE_6MAX;
  stackDepth: typeof STACK_DEPTH_100BB;
  heroPosition: Position;
  /** A slug: `rfi`, `vs_btn_open`. Validated in `validate.ts`. */
  actionSequence: string;
}

/**
 * Flat rather than nesting the key, so a chart is shaped exactly like the
 * `range_charts` row it becomes in Phase 4.
 */
export interface RangeChart extends ChartKey {
  skillTags: readonly string[];
  ranges: Range;
}

export interface ChartSet {
  version: string;
  published: boolean;
  notes?: string;
  charts: readonly RangeChart[];
}

export function chartKeyOf(chart: RangeChart): ChartKey {
  return {
    tableSize: chart.tableSize,
    stackDepth: chart.stackDepth,
    heroPosition: chart.heroPosition,
    actionSequence: chart.actionSequence,
  };
}

export function chartKeyId(key: ChartKey): string {
  return `${key.tableSize}|${key.stackDepth}|${key.heroPosition}|${key.actionSequence}`;
}

export type ChartRegistry = ReadonlyMap<string, RangeChart>;

/**
 * Indexes a set for lookup. Throws on a duplicate key rather than letting one
 * chart shadow another — silently keeping the last one would mean the app
 * teaches from a chart the author thought they had replaced.
 */
export function createChartRegistry(set: ChartSet): ChartRegistry {
  const registry = new Map<string, RangeChart>();

  for (const chart of set.charts) {
    const id = chartKeyId(chartKeyOf(chart));
    if (registry.has(id)) {
      throw new RangeError(`duplicate chart key ${id} in chart set "${set.version}"`);
    }
    registry.set(id, chart);
  }

  return registry;
}

export function lookupChart(registry: ChartRegistry, key: ChartKey): RangeChart | undefined {
  return registry.get(chartKeyId(key));
}

/** As `lookupChart`, but for callers with no sensible fallback. */
export function requireChart(registry: ChartRegistry, key: ChartKey): RangeChart {
  const chart = registry.get(chartKeyId(key));
  if (chart === undefined) {
    throw new RangeError(`no chart for key ${chartKeyId(key)}`);
  }
  return chart;
}
