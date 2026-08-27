/**
 * The seeded learning track.
 *
 * Lessons are content, not code: `lessons.body` is a jsonb column, so this
 * syncs to Supabase and a typo can be fixed without a deploy — the same
 * property the range charts have, and the reason docs/01-architecture.md puts
 * both here rather than in components.
 *
 * As with the chart set, validation is deliberately not run at import time.
 * `rawTracks` is exported unvalidated so the test suite can report every
 * problem at once rather than dying on import with a stack trace.
 */

import type { DrillTemplate, PlacementGroup, Track } from '@poker/engine';
import { parseTracks, placementOrder as orderPlacementTags } from '@poker/engine';

import { loadChartRegistry } from './chart-set';
import { loadDrillTemplates } from './drill-templates';
import preflopFundamentals from './lessons/preflop-fundamentals.json';

/** Unvalidated. Use `loadTracks()` unless you are the validator's test. */
export const rawTracks: unknown = preflopFundamentals;

let parsed: readonly Track[] | undefined;

/**
 * The validated tracks. Throws once, listing every problem, if invalid.
 *
 * Validated **against the charts and templates**, not just structurally. A
 * `range` block naming a chart nobody authored, or a `drill` block naming a
 * template that does not exist, does not crash — it renders an empty box to a
 * student who assumes the gap is deliberate. Only the registry can see that.
 */
export function loadTracks(): readonly Track[] {
  parsed ??= parseTracks(rawTracks, {
    registry: loadChartRegistry(),
    templates: loadDrillTemplates(),
  });
  return parsed;
}

export function findTrack(slug: string): Track | undefined {
  return loadTracks().find((track) => track.slug === slug);
}

/**
 * The placement ordering for the bundled content.
 *
 * A convenience over the engine's `placementOrder`, which takes its inputs as
 * arguments so the web app can apply the identical rule to whatever the
 * database actually published.
 */
export function placementOrder(
  tracks: readonly Track[] = loadTracks(),
  templates: readonly DrillTemplate[] = loadDrillTemplates(),
): readonly PlacementGroup[] {
  return orderPlacementTags(tracks, templates);
}
