/**
 * The seeded drill templates.
 *
 * Templates are content, not code: `drill_templates` is a content table with a
 * `config jsonb` column, so these sync to Supabase in Phase 4 and can be
 * retuned without a deploy — exactly as the range charts do.
 *
 * As with the chart set, validation is deliberately not run at import time.
 * `rawDrillTemplates` is exported unvalidated so the test suite can report every
 * problem at once instead of dying on import with a stack trace.
 */

import type { DrillTemplate } from '@poker/engine';
import { parseDrillTemplates } from '@poker/engine';

import { loadChartRegistry } from './chart-set';
import templates from './drill-templates.json';

/** Unvalidated. Use `loadDrillTemplates()` unless you are the validator's test. */
export const rawDrillTemplates: unknown = templates;

let parsed: readonly DrillTemplate[] | undefined;

/**
 * The validated templates. Throws once, listing every problem, if invalid.
 *
 * Validated *against the charts*, not just structurally: a template presenting
 * an open size its opener's chart was not authored for resolves to a real spot
 * and grades against the wrong range, which no structural check can see.
 */
export function loadDrillTemplates(): readonly DrillTemplate[] {
  parsed ??= parseDrillTemplates(rawDrillTemplates, loadChartRegistry());
  return parsed;
}

/** Looks a template up by slug, which is unique. */
export function findDrillTemplate(slug: string): DrillTemplate | undefined {
  return loadDrillTemplates().find((template) => template.slug === slug);
}
