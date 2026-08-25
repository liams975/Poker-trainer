/**
 * Chart set validation.
 *
 * Hand-written rather than a Zod schema, because CI asserts `packages/engine`
 * has zero runtime dependencies and docs/01-architecture.md rests the v2 React
 * Native story on that. The compensation is that this collects *every* error
 * with a domain-shaped path — `charts[2].ranges.AJo: frequencies sum to 0.97`
 * — rather than throwing at the first structural problem. Editing ten charts,
 * that difference is the whole ergonomics of the thing.
 *
 * Validation runs wherever charts are loaded, which from Phase 4 includes
 * JSONB arriving from Supabase, not only the authored files in
 * `packages/content`.
 */

import { CANONICAL_HANDS } from '../cards';

import { SIZED_ACTIONS, isAction } from './action';
import type { ChartSet, RangeChart } from './chart';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, chartKeyId, chartKeyOf, isPosition } from './chart';
import type { ActionFreq } from './range';
import { FREQ_TOLERANCE, frequencySum } from './range';

export interface ChartError {
  /** Where the problem is, e.g. `charts[2].ranges.AJo`. */
  path: string;
  message: string;
}

export type ChartValidation =
  | { ok: true; value: ChartSet }
  | { ok: false; errors: readonly ChartError[] };

const SLUG = /^[a-z0-9_]+$/;
const SKILL_TAG = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const CANONICAL = new Set<string>(CANONICAL_HANDS);

function show(value: unknown): string {
  // JSON.stringify turns Infinity and NaN into "null", which makes for a
  // baffling error message. Strings still get quoted so empties are visible.
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value) ?? String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class ErrorBag {
  readonly errors: ChartError[] = [];

  add(path: string, message: string): void {
    this.errors.push({ path, message });
  }
}

function checkActionFreq(bag: ErrorBag, path: string, raw: unknown): void {
  if (!isRecord(raw)) {
    bag.add(path, 'expected an object like { action, freq }');
    return;
  }

  const { action, freq, size } = raw;

  if (!isAction(action)) {
    bag.add(path, `unknown action ${show(action)}`);
  }

  if (typeof freq !== 'number' || !Number.isFinite(freq) || freq <= 0 || freq > 1) {
    // Zero is rejected, not tolerated. Phase 3 grades a frequency of zero as a
    // blunder, so "listed at 0%" and "not listed" must not both be sayable.
    bag.add(path, `freq must be a number in (0, 1], got ${show(freq)}`);
  }

  if (isAction(action)) {
    const needsSize = SIZED_ACTIONS.includes(action);

    if (needsSize && size === undefined) {
      bag.add(path, `a ${action} needs a size, in big blinds`);
    }
    if (!needsSize && size !== undefined) {
      bag.add(path, `a ${action} cannot carry a size`);
    }
    if (size !== undefined && (typeof size !== 'number' || !Number.isFinite(size) || size <= 0)) {
      bag.add(path, `size must be a positive number, got ${show(size)}`);
    }
  }
}

function checkRanges(bag: ErrorBag, path: string, raw: unknown): void {
  if (!isRecord(raw)) {
    bag.add(path, 'expected an object mapping hands to action frequencies');
    return;
  }

  if (Object.keys(raw).length === 0) {
    // Every hand folding is not a range. Left unchecked, a wiped `ranges` blob
    // arriving from Supabase in Phase 4 would validate cleanly.
    bag.add(path, 'a chart must list at least one hand');
    return;
  }

  for (const [hand, entries] of Object.entries(raw)) {
    const handPath = `${path}.${hand}`;

    if (!CANONICAL.has(hand)) {
      bag.add(handPath, `"${hand}" is not one of the 169 canonical hands`);
      continue;
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      bag.add(handPath, 'expected a non-empty array of action frequencies');
      continue;
    }

    const before = bag.errors.length;
    entries.forEach((entry, i) => checkActionFreq(bag, `${handPath}[${i}]`, entry));
    // Captured before the duplicate check below, which is not an entry-level
    // malformation and must not suppress the sum error too.
    const entriesWellFormed = bag.errors.length === before;

    // A duplicate (action, size) is a real mistake; the same action at two
    // different sizes is a legitimate mix.
    const seen = new Set<string>();
    for (const entry of entries as ActionFreq[]) {
      if (!isRecord(entry)) continue;
      const id = `${String(entry.action)}@${String(entry.size ?? '-')}`;
      if (seen.has(id)) {
        bag.add(handPath, `${String(entry.action)} appears twice at the same size`);
      }
      seen.add(id);
    }

    // Only meaningful once the individual entries are well-formed.
    if (entriesWellFormed) {
      const sum = frequencySum(entries as ActionFreq[]);
      if (Math.abs(sum - 1) > FREQ_TOLERANCE) {
        bag.add(handPath, `frequencies sum to ${sum.toFixed(4)}, expected 1.0`);
      }

      // The same rule that rejects freq: 0 — an all-fold entry says exactly
      // what absence says, and two encodings of one strategy are observable to
      // anything that iterates `chart.ranges` directly.
      if ((entries as ActionFreq[]).every((e) => e.action === 'fold')) {
        bag.add(handPath, 'a pure fold is the default — omit the hand rather than listing it');
      }
    }
  }
}

function checkChart(bag: ErrorBag, path: string, raw: unknown): void {
  if (!isRecord(raw)) {
    bag.add(path, 'expected a chart object');
    return;
  }

  if (raw.tableSize !== TABLE_SIZE_6MAX) {
    bag.add(`${path}.tableSize`, `v1 is 6-max only, got ${JSON.stringify(raw.tableSize)}`);
  }
  if (raw.stackDepth !== STACK_DEPTH_100BB) {
    bag.add(`${path}.stackDepth`, `v1 is 100bb only, got ${JSON.stringify(raw.stackDepth)}`);
  }
  if (!isPosition(raw.heroPosition)) {
    bag.add(
      `${path}.heroPosition`,
      `expected one of UTG HJ CO BTN SB BB, got ${JSON.stringify(raw.heroPosition)}`,
    );
  }
  if (typeof raw.actionSequence !== 'string' || !SLUG.test(raw.actionSequence)) {
    bag.add(
      `${path}.actionSequence`,
      `expected a lowercase slug like "rfi" or "vs_btn_open", got ${JSON.stringify(raw.actionSequence)}`,
    );
  }

  if (!Array.isArray(raw.skillTags)) {
    bag.add(`${path}.skillTags`, 'expected an array of skill tags');
  } else {
    raw.skillTags.forEach((tag, i) => {
      if (typeof tag !== 'string' || !SKILL_TAG.test(tag)) {
        bag.add(
          `${path}.skillTags[${i}]`,
          `expected a dotted slug like "preflop.rfi.utg", got ${JSON.stringify(tag)}`,
        );
      }
    });
  }

  checkRanges(bag, `${path}.ranges`, raw.ranges);
}

export function validateChartSet(data: unknown): ChartValidation {
  const bag = new ErrorBag();

  if (!isRecord(data)) {
    return { ok: false, errors: [{ path: '', message: 'expected a chart set object' }] };
  }

  if (typeof data.version !== 'string' || data.version.length === 0) {
    bag.add('version', 'expected a non-empty version string');
  }
  if (typeof data.published !== 'boolean') {
    bag.add('published', `expected a boolean, got ${JSON.stringify(data.published)}`);
  }
  if (data.notes !== undefined && typeof data.notes !== 'string') {
    bag.add('notes', 'expected a string when present');
  }

  if (!Array.isArray(data.charts) || data.charts.length === 0) {
    bag.add('charts', 'expected a non-empty array of charts');
    return { ok: false, errors: bag.errors };
  }

  data.charts.forEach((chart, i) => checkChart(bag, `charts[${i}]`, chart));

  // Mirrors the unique constraint on range_charts. Checked after the per-chart
  // pass so a malformed key is reported as malformed, not as a collision.
  const seen = new Map<string, number>();
  data.charts.forEach((chart, i) => {
    if (!isRecord(chart) || !isPosition(chart.heroPosition)) return;
    const id = chartKeyId(chartKeyOf(chart as unknown as RangeChart));
    const first = seen.get(id);
    if (first !== undefined) {
      bag.add(`charts[${i}]`, `duplicate chart key ${id}, already defined at charts[${first}]`);
    } else {
      seen.set(id, i);
    }
  });

  if (bag.errors.length > 0) {
    return { ok: false, errors: bag.errors };
  }

  return { ok: true, value: data as unknown as ChartSet };
}

/** As `validateChartSet`, but throws a single error listing every problem. */
export function parseChartSet(data: unknown): ChartSet {
  const result = validateChartSet(data);

  if (result.ok) return result.value;

  const detail = result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
  throw new TypeError(`chart set is invalid (${result.errors.length} problems):\n${detail}`);
}
