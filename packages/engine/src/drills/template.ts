/**
 * A drill template: a family of spots, not a spot.
 *
 * docs/03-poker-engine.md: "A `DrillTemplate` describes a family of spots:
 * position constraints, action sequence, hand-sampling weights. Generation
 * takes a template plus a seed and produces a concrete spot."
 *
 * These are content, not code — `drill_templates` is a content table with a
 * `config jsonb` column — so they are authored as JSON in packages/content and
 * validated here, the same way charts are. The validator collects every error
 * with a path rather than throwing at the first, because editing a set of
 * templates you want all the problems at once.
 */

import { CANONICAL_HANDS } from '../cards';
import type { ChartRegistry, Position, RangeChart } from '../ranges';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, isPosition, lookupChart } from '../ranges';
import { MAX_OPEN_BLINDS } from '../strategy';

import type { SamplingOptions } from './sampling';

/** Which chart family a template drills. Phase 2 seeded exactly these two. */
export const DRILL_SPOTS = ['rfi', 'vs_open'] as const;

export type DrillSpotKind = (typeof DRILL_SPOTS)[number];

/**
 * An alias, not a copy. These were two structurally identical declarations that
 * compiled only because they happened to match; `template.sampling` is passed
 * straight to `samplingWeights`, so they must not be able to drift apart.
 */
export type HandSampling = SamplingOptions;

export interface DrillTemplate {
  slug: string;
  title: string;
  spot: DrillSpotKind;
  /** Hero positions this template draws from. */
  positions: readonly Position[];
  /** Which seats open, for `vs_open`. */
  openers?: readonly Position[];
  /** The open size presented, in big blinds. `vs_open` only. */
  openSize?: number;
  sampling?: HandSampling;
  skillTags: readonly string[];
  published: boolean;
}

export interface TemplateError {
  path: string;
  message: string;
}

export type TemplateValidation =
  | { ok: true; value: readonly DrillTemplate[] }
  | { ok: false; errors: readonly TemplateError[] };

const SLUG = /^[a-z0-9-]+$/;
const SKILL_TAG = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const CANONICAL = new Set<string>(CANONICAL_HANDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkPositions(
  errors: TemplateError[],
  path: string,
  raw: unknown,
  { forbidBigBlind = false, requireBigBlind = false } = {},
): void {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push({ path, message: 'expected a non-empty array of positions' });
    return;
  }

  const seen = new Set<unknown>();
  for (const value of raw) {
    if (!isPosition(value)) {
      errors.push({ path, message: `unknown position ${JSON.stringify(value)}` });
      continue;
    }
    if (seen.has(value)) errors.push({ path, message: `${value} listed twice` });
    seen.add(value);
  }

  if (forbidBigBlind && seen.has('BB')) {
    errors.push({ path, message: 'the big blind is never first in, so it cannot open' });
  }
  if (requireBigBlind && (seen.size !== 1 || !seen.has('BB'))) {
    errors.push({
      path,
      message: 'only big blind defence is seeded, so a vs_open template draws BB only',
    });
  }
}

function checkSampling(errors: TemplateError[], path: string, raw: unknown): void {
  if (raw === undefined) return;

  if (!isRecord(raw)) {
    errors.push({ path, message: 'expected a sampling object' });
    return;
  }

  const { uniformShare, include } = raw;

  if (uniformShare !== undefined) {
    if (typeof uniformShare !== 'number' || !Number.isFinite(uniformShare) || uniformShare < 0 || uniformShare > 1) {
      errors.push({
        path: `${path}.uniformShare`,
        message: `expected a number in [0, 1], got ${JSON.stringify(uniformShare)}`,
      });
    }
  }

  if (include !== undefined) {
    if (!Array.isArray(include) || include.length === 0) {
      errors.push({ path: `${path}.include`, message: 'expected a non-empty array of hands' });
      return;
    }
    const seen = new Set<unknown>();
    for (const hand of include) {
      if (typeof hand !== 'string' || !CANONICAL.has(hand)) {
        errors.push({
          path: `${path}.include`,
          message: `${JSON.stringify(hand)} is not one of the 169 canonical hands`,
        });
        continue;
      }
      // A duplicate is counted twice in the normalisation totals but keyed once,
      // so it silently *under*weights the very hand the author asked for more of.
      if (seen.has(hand)) {
        errors.push({ path: `${path}.include`, message: `${hand} listed twice` });
      }
      seen.add(hand);
    }
  }
}

/**
 * The single size a chart opens to, or undefined if it does not have one.
 *
 * The seeded charts each raise to exactly one size, and that size is the spot
 * they were authored for — a defence chart written against a 2.5bb open means
 * something different against a 3bb one.
 */
function chartOpenSize(chart: RangeChart): number | undefined {
  const sizes = new Set<number>();

  for (const entries of Object.values(chart.ranges)) {
    for (const entry of entries) {
      if (entry.action === 'raise' && entry.size !== undefined) sizes.add(entry.size);
    }
  }

  return sizes.size === 1 ? [...sizes][0] : undefined;
}

/**
 * Checks a template's open size against the size the opener's chart actually
 * uses, which is the constraint that matters and the one the structural band
 * cannot express.
 */
function checkOpenSizeAgainstCharts(
  errors: TemplateError[],
  path: string,
  raw: Record<string, unknown>,
  registry: ChartRegistry,
): void {
  if (typeof raw.openSize !== 'number' || !Array.isArray(raw.openers)) return;

  for (const opener of raw.openers) {
    if (!isPosition(opener)) continue;

    const chart = lookupChart(registry, {
      tableSize: TABLE_SIZE_6MAX,
      stackDepth: STACK_DEPTH_100BB,
      heroPosition: opener,
      actionSequence: 'rfi',
    });

    if (chart === undefined) {
      errors.push({ path: `${path}.openers`, message: `no rfi chart is seeded for ${opener}` });
      continue;
    }

    const authored = chartOpenSize(chart);
    if (authored === undefined) {
      errors.push({
        path: `${path}.openers`,
        message: `${opener}'s rfi chart does not open to a single size, so it cannot be drilled against`,
      });
      continue;
    }

    if (Math.abs(authored - raw.openSize) > 0.001) {
      errors.push({
        path: `${path}.openSize`,
        message: `${opener} opens to ${authored}bb in its chart, but this template presents ${raw.openSize}bb`,
      });
    }
  }
}

function checkTemplate(
  errors: TemplateError[],
  path: string,
  raw: unknown,
  registry: ChartRegistry | undefined,
): void {
  if (!isRecord(raw)) {
    errors.push({ path, message: 'expected a template object' });
    return;
  }

  if (typeof raw.slug !== 'string' || !SLUG.test(raw.slug)) {
    errors.push({
      path: `${path}.slug`,
      message: `expected a lowercase hyphenated slug, got ${JSON.stringify(raw.slug)}`,
    });
  }
  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
    errors.push({ path: `${path}.title`, message: 'expected a non-empty title' });
  }
  if (typeof raw.published !== 'boolean') {
    errors.push({
      path: `${path}.published`,
      message: `expected a boolean, got ${JSON.stringify(raw.published)}`,
    });
  }

  const spot = raw.spot;
  if (spot !== 'rfi' && spot !== 'vs_open') {
    errors.push({
      path: `${path}.spot`,
      message: `expected one of ${DRILL_SPOTS.join(', ')}, got ${JSON.stringify(spot)}`,
    });
  }

  checkPositions(errors, `${path}.positions`, raw.positions, {
    forbidBigBlind: spot === 'rfi',
    requireBigBlind: spot === 'vs_open',
  });

  if (spot === 'vs_open') {
    if (raw.openers === undefined) {
      errors.push({ path: `${path}.openers`, message: 'a vs_open template needs openers' });
    } else {
      checkPositions(errors, `${path}.openers`, raw.openers, { forbidBigBlind: true });
    }

    // A resolvability floor, not the real constraint. Outside this band
    // `deriveActionSequence` refuses the spot outright, so a template would
    // generate unanswerable drills. Inside it, the spot resolves but may still
    // be graded against a chart authored for a different open — the seeded
    // charts model exactly 2.5 and 3.0, not the whole band. Only the registry
    // check below can tell those apart.
    if (
      typeof raw.openSize !== 'number' ||
      !Number.isFinite(raw.openSize) ||
      raw.openSize <= 1 ||
      raw.openSize > MAX_OPEN_BLINDS
    ) {
      errors.push({
        path: `${path}.openSize`,
        message: `expected an open size in (1, ${MAX_OPEN_BLINDS}] big blinds, got ${JSON.stringify(raw.openSize)}`,
      });
    } else if (registry !== undefined) {
      checkOpenSizeAgainstCharts(errors, path, raw, registry);
    }
  } else {
    if (raw.openers !== undefined) {
      errors.push({ path: `${path}.openers`, message: 'an rfi template has no openers' });
    }
    if (raw.openSize !== undefined) {
      errors.push({ path: `${path}.openSize`, message: 'an rfi template has no open size' });
    }
  }

  if (!Array.isArray(raw.skillTags)) {
    errors.push({ path: `${path}.skillTags`, message: 'expected an array of skill tags' });
  } else {
    for (const tag of raw.skillTags) {
      if (typeof tag !== 'string' || !SKILL_TAG.test(tag)) {
        errors.push({
          path: `${path}.skillTags`,
          message: `expected a dotted slug like "preflop.rfi.utg", got ${JSON.stringify(tag)}`,
        });
      }
    }
  }

  checkSampling(errors, `${path}.sampling`, raw.sampling);
}

/**
 * Pass the chart registry whenever it is available. Without it only the
 * structural rules run, which cannot catch a template that presents an open
 * size no chart was authored against — the exact mistake that forced blind
 * defence to be split into two templates. Phase 4 loads templates from Supabase,
 * where nothing else checks this.
 */
export function validateDrillTemplates(
  data: unknown,
  registry?: ChartRegistry,
): TemplateValidation {
  if (!Array.isArray(data)) {
    return { ok: false, errors: [{ path: '', message: 'expected an array of drill templates' }] };
  }
  if (data.length === 0) {
    return { ok: false, errors: [{ path: '', message: 'expected at least one drill template' }] };
  }

  const errors: TemplateError[] = [];
  data.forEach((template, index) => checkTemplate(errors, `[${index}]`, template, registry));

  // Mirrors the unique constraint on drill_templates.slug.
  const seen = new Map<string, number>();
  data.forEach((template, index) => {
    if (!isRecord(template) || typeof template.slug !== 'string') return;
    const first = seen.get(template.slug);
    if (first !== undefined) {
      errors.push({
        path: `[${index}].slug`,
        message: `duplicate slug "${template.slug}", already used at [${first}]`,
      });
    } else {
      seen.set(template.slug, index);
    }
  });

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, value: data as readonly DrillTemplate[] };
}

/** As `validateDrillTemplates`, but throws a single error listing every problem. */
export function parseDrillTemplates(
  data: unknown,
  registry?: ChartRegistry,
): readonly DrillTemplate[] {
  const result = validateDrillTemplates(data, registry);
  if (result.ok) return result.value;

  const detail = result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
  throw new TypeError(`drill templates are invalid (${result.errors.length} problems):\n${detail}`);
}
