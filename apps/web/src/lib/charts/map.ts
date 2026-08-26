import type { ChartSet, RangeChart } from '@poker/engine';
import { parseChartSet } from '@poker/engine';

/**
 * Turning `range_charts` rows into a validated `ChartSet`.
 *
 * The rows come back snake_case from PostgREST and `ranges` is an opaque jsonb
 * blob. Rather than trust it, the mapped set goes through **the engine's own
 * `parseChartSet`** — the identical validator `packages/content` runs at build
 * time, which checks the 169 canonical hands, that every distribution sums to
 * 1.0, and that action names are real.
 *
 * That matters because the database is writable by a service-role script. A
 * sync bug, a partial write, or a hand-edited row would otherwise render as a
 * confidently wrong range, and a range chart that is subtly wrong is worse than
 * one that fails to load: the user studies it and believes it.
 *
 * @poker/content stays the schema authority. The database is where the bytes
 * live, not what decides whether they are valid.
 */

/** One `range_charts` row, as PostgREST returns it. */
export interface RangeChartRow {
  table_size: number;
  stack_depth: number;
  hero_position: string;
  action_sequence: string;
  ranges: unknown;
  skill_tags: string[] | null;
}

export interface ChartSetRow {
  version: string;
  published: boolean;
  notes: string | null;
  range_charts: RangeChartRow[];
}

/**
 * Maps and validates. Throws with every problem listed, not just the first —
 * `parseChartSet` collects them, which is what makes a bad sync diagnosable.
 */
export function toChartSet(row: ChartSetRow): ChartSet {
  return parseChartSet({
    version: row.version,
    published: row.published,
    ...(row.notes === null ? {} : { notes: row.notes }),
    charts: row.range_charts.map((chart) => ({
      tableSize: chart.table_size,
      stackDepth: chart.stack_depth,
      heroPosition: chart.hero_position,
      actionSequence: chart.action_sequence,
      ranges: chart.ranges,
      skillTags: chart.skill_tags ?? [],
    })),
  });
}

/**
 * How a chart is labelled in the selector and in compare mode.
 *
 * Two families exist today: opening first-in, and big-blind defence against a
 * named opener. Anything else falls back to showing the raw sequence rather
 * than inventing a label for a spot nobody has authored yet.
 */
export function chartLabel(chart: RangeChart): string {
  if (chart.actionSequence === 'rfi') return `${chart.heroPosition} open`;

  const versus = /^vs_([a-z]+)_open$/.exec(chart.actionSequence);
  if (versus?.[1]) return `${chart.heroPosition} vs ${versus[1].toUpperCase()} open`;

  return `${chart.heroPosition} · ${chart.actionSequence}`;
}

export type ChartFamily = 'open' | 'defend' | 'other';

export function chartFamily(chart: RangeChart): ChartFamily {
  if (chart.actionSequence === 'rfi') return 'open';
  if (/^vs_[a-z]+_open$/.test(chart.actionSequence)) return 'defend';
  return 'other';
}

/** Stable id for URL state and React keys. Mirrors `chartKeyId` in the engine. */
export function chartId(chart: RangeChart): string {
  return `${chart.heroPosition}-${chart.actionSequence}`;
}
