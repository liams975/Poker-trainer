/**
 * The seeded 6-max 100bb chart set.
 *
 * Content is data, not code (docs/01-architecture.md): these charts sync to
 * `range_charts` in Phase 4 and can be retuned without a deploy — and in v2,
 * without an App Store resubmission. Every drill attempt records
 * `CHART_SET_VERSION`, so a past attempt stays interpretable after a chart
 * changes. **Bump the version whenever a range changes.**
 *
 * Validation is deliberately not run at import time. `rawChartSet` is exported
 * unvalidated so the test suite can call `validateChartSet` and report every
 * problem at once; a module-level `parseChartSet` would instead blow up on
 * import and show only a stack trace.
 */

import type { ChartRegistry, ChartSet } from '@poker/engine';
import { createChartRegistry, parseChartSet } from '@poker/engine';

import bbDefense from './charts/bb-defense.json';
import rfi from './charts/rfi.json';

export const CHART_SET_VERSION = '2026.08.25-1';

const NOTES = [
  '6-max 100bb preflop ranges authored for teaching. They are approximations',
  'in the shape of standard charts, not transcriptions of any published chart',
  'and not solver output — consistent with the locked decision in',
  'docs/01-architecture.md that strategy is preflop charts plus postflop',
  'heuristics rather than a real solver.',
  '',
  'Coverage: open-raise-first-in from UTG/HJ/CO/BTN/SB, and big blind defence',
  'against each of those opens. The 3-bet and vs-3-bet families are not seeded',
  'yet; they are pure data additions and need no code change.',
  '',
  'Known simplification: SB RFI is modelled raise-or-fold at 3bb, omitting the',
  'limp/raise mix that solvers use from the small blind.',
].join('\n');

/** Unvalidated. Use `loadChartSet()` unless you are the validator's test. */
export const rawChartSet: unknown = {
  version: CHART_SET_VERSION,
  published: true,
  notes: NOTES,
  charts: [...rfi, ...bbDefense],
};

let parsed: ChartSet | undefined;
let registry: ChartRegistry | undefined;

/** The validated chart set. Throws once, listing every problem, if invalid. */
export function loadChartSet(): ChartSet {
  parsed ??= parseChartSet(rawChartSet);
  return parsed;
}

/** The validated set, indexed for `lookupChart` / `requireChart`. */
export function loadChartRegistry(): ChartRegistry {
  registry ??= createChartRegistry(loadChartSet());
  return registry;
}
