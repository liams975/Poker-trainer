import type { ChartRegistry, DrillTemplate } from '@poker/engine';
import { parseDrillTemplates } from '@poker/engine';

/**
 * Turning `drill_templates` rows into validated `DrillTemplate`s.
 *
 * Same reasoning as lib/charts/map.ts: `config` is an opaque jsonb blob written
 * by a service-role script, so it goes through **the engine's own
 * `parseDrillTemplates`** rather than being trusted. The registry is passed in
 * deliberately — without it only the structural rules run, and the one mistake
 * that actually reached us before (a template presenting a 2.5bb open against a
 * chart authored for 3bb) is exactly the one the registry check catches.
 *
 * A template that lies about its open size does not fail loudly at drill time.
 * It generates a perfectly plausible spot and grades the answer against a chart
 * written for a different one, which is the failure mode this codebase treats
 * as worse than a crash.
 */

/** One `drill_templates` row, as PostgREST returns it. */
export interface DrillTemplateRow {
  id: string;
  slug: string;
  title: string;
  config: unknown;
  skill_tags: string[] | null;
  published: boolean;
}

/** A validated template alongside the database id an attempt has to reference. */
export interface StoredTemplate {
  id: string;
  template: DrillTemplate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Maps and validates the whole set at once, because `parseDrillTemplates`
 * collects every problem with its path rather than throwing at the first — when
 * a sync has gone wrong you want all of it, not one line at a time.
 */
export function toDrillTemplates(
  rows: readonly DrillTemplateRow[],
  registry: ChartRegistry,
): readonly StoredTemplate[] {
  const candidates = rows.map((row) => ({
    // `config` holds spot, positions, openers, openSize and sampling. It is
    // spread FIRST so that the row's own columns win: a malformed blob carrying
    // its own `slug` or `published` must not be able to rewrite the identity of
    // the row it lives in, which is what decides whether it is drilled at all.
    ...(isRecord(row.config) ? row.config : {}),
    slug: row.slug,
    title: row.title,
    skillTags: row.skill_tags ?? [],
    published: row.published,
  }));

  const parsed = parseDrillTemplates(candidates, registry);

  return parsed.map((template, index) => ({ id: rows[index]!.id, template }));
}
