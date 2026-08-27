/**
 * The lesson content format.
 *
 * Lessons are content, not code — `lessons.body` is a jsonb column, authored in
 * `packages/content` and synced without a deploy, exactly as charts and drill
 * templates are. So the schema lives here with the other two validators, and
 * the data lives there.
 *
 * Hand-written rather than a Zod schema, for the same reason `ranges/validate`
 * is: this package must keep zero runtime dependencies. The compensation is the
 * same too — every problem at once, each with a path.
 *
 * The checks that matter most are the ones a structural validator cannot make.
 * A `range` block naming a chart nobody authored, or a `drill` block naming a
 * template that does not exist, will not crash: it renders an empty box to a
 * student who assumes the gap is deliberate. Those need the registry and the
 * template list, so the validator takes both.
 */

import type { HandNotation } from '../cards';
import { CANONICAL_HANDS } from '../cards';
import type { DrillTemplate } from '../drills';
import type { ChartRegistry, Position } from '../ranges';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, isPosition, lookupChart } from '../ranges';

export const BLOCK_KINDS = [
  'prose',
  'key_points',
  'callout',
  'range',
  'hands',
  'drill',
] as const;

export type BlockKind = (typeof BLOCK_KINDS)[number];

export const CALLOUT_TONES = ['note', 'warning'] as const;

export type CalloutTone = (typeof CALLOUT_TONES)[number];

export type LessonBlock =
  | { kind: 'prose'; text: string }
  | { kind: 'key_points'; points: readonly string[] }
  | { kind: 'callout'; tone: CalloutTone; text: string }
  | { kind: 'range'; heroPosition: Position; actionSequence: string; caption?: string }
  | { kind: 'hands'; hands: readonly HandNotation[]; caption?: string }
  | { kind: 'drill'; templateSlug: string; spots: number };

export interface Lesson {
  slug: string;
  title: string;
  summary: string;
  blocks: readonly LessonBlock[];
  /** At least one. A lesson with no tag cannot be placed into or linked to. */
  skillTags: readonly string[];
  sortOrder: number;
  version: string;
}

export interface CurriculumModule {
  slug: string;
  title: string;
  sortOrder: number;
  lessons: readonly Lesson[];
}

export interface Track {
  slug: string;
  title: string;
  description?: string;
  sortOrder: number;
  published: boolean;
  modules: readonly CurriculumModule[];
}

export interface CurriculumError {
  /** e.g. `[0].modules[1].lessons[2].blocks[3]`. */
  path: string;
  message: string;
}

export type CurriculumValidation =
  | { ok: true; value: readonly Track[] }
  | { ok: false; errors: readonly CurriculumError[] };

/**
 * The registry and templates are optional so a test editing prose need not
 * assemble the whole content graph. Pass them wherever they exist — the sync
 * script and the web mapper both have them, and they are the only two places
 * where a dangling reference reaches a reader.
 */
export interface CurriculumContext {
  registry?: ChartRegistry | undefined;
  templates?: readonly DrillTemplate[] | undefined;
}

const SLUG = /^[a-z0-9-]+$/;
const SKILL_TAG = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const CANONICAL = new Set<string>(CANONICAL_HANDS);
const MAX_DRILL_SPOTS = 25;

function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value) ?? String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class ErrorBag {
  readonly errors: CurriculumError[] = [];

  add(path: string, message: string): void {
    this.errors.push({ path, message });
  }

  text(path: string, value: unknown, field: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      this.add(path, `${field} must be a non-empty string, got ${show(value)}`);
    }
  }

  slug(path: string, value: unknown): void {
    if (typeof value !== 'string' || !SLUG.test(value)) {
      this.add(path, `expected a lowercase hyphenated slug, got ${show(value)}`);
    }
  }

  order(path: string, value: unknown): void {
    if (!Number.isInteger(value)) {
      this.add(path, `sortOrder must be an integer, got ${show(value)}`);
    }
  }
}

/** Duplicate slugs mirror the unique constraints on `modules` and `lessons`. */
function checkUniqueSlugs(bag: ErrorBag, path: string, items: readonly unknown[]): void {
  const seen = new Map<string, number>();

  items.forEach((item, index) => {
    if (!isRecord(item) || typeof item.slug !== 'string') return;

    const first = seen.get(item.slug);
    if (first !== undefined) {
      bag.add(`${path}[${index}].slug`, `duplicate slug ${show(item.slug)}, already used at [${first}]`);
    } else {
      seen.set(item.slug, index);
    }
  });
}

function checkBlock(
  bag: ErrorBag,
  path: string,
  raw: unknown,
  context: CurriculumContext,
): void {
  if (!isRecord(raw)) {
    bag.add(path, 'expected a block object');
    return;
  }

  const kind = raw.kind;
  if (typeof kind !== 'string' || !(BLOCK_KINDS as readonly string[]).includes(kind)) {
    bag.add(path, `unknown block kind ${show(kind)}, expected one of ${BLOCK_KINDS.join(', ')}`);
    return;
  }

  switch (kind as BlockKind) {
    case 'prose':
      bag.text(`${path}.text`, raw.text, 'text');
      return;

    case 'key_points': {
      if (!Array.isArray(raw.points) || raw.points.length === 0) {
        bag.add(`${path}.points`, 'expected a non-empty array of points');
        return;
      }
      raw.points.forEach((point, index) => {
        bag.text(`${path}.points[${index}]`, point, 'point');
      });
      return;
    }

    case 'callout': {
      if (
        typeof raw.tone !== 'string' ||
        !(CALLOUT_TONES as readonly string[]).includes(raw.tone)
      ) {
        bag.add(
          `${path}.tone`,
          `expected one of ${CALLOUT_TONES.join(', ')}, got ${show(raw.tone)}`,
        );
      }
      bag.text(`${path}.text`, raw.text, 'text');
      return;
    }

    case 'range': {
      if (!isPosition(raw.heroPosition)) {
        bag.add(`${path}.heroPosition`, `unknown position ${show(raw.heroPosition)}`);
      }
      if (typeof raw.actionSequence !== 'string' || raw.actionSequence.length === 0) {
        bag.add(`${path}.actionSequence`, 'expected an action sequence');
      }
      if (raw.caption !== undefined) bag.text(`${path}.caption`, raw.caption, 'caption');

      // The check a structural validator cannot make.
      if (
        context.registry !== undefined &&
        isPosition(raw.heroPosition) &&
        typeof raw.actionSequence === 'string'
      ) {
        const chart = lookupChart(context.registry, {
          tableSize: TABLE_SIZE_6MAX,
          stackDepth: STACK_DEPTH_100BB,
          heroPosition: raw.heroPosition,
          actionSequence: raw.actionSequence,
        });
        if (chart === undefined) {
          bag.add(
            path,
            `no chart is authored for ${raw.heroPosition}/${raw.actionSequence}, so this block would render empty`,
          );
        }
      }
      return;
    }

    case 'hands': {
      if (!Array.isArray(raw.hands) || raw.hands.length === 0) {
        bag.add(`${path}.hands`, 'expected a non-empty array of hands');
        return;
      }
      const seen = new Set<unknown>();
      raw.hands.forEach((hand, index) => {
        if (typeof hand !== 'string' || !CANONICAL.has(hand)) {
          bag.add(`${path}.hands[${index}]`, `${show(hand)} is not one of the 169 canonical hands`);
          return;
        }
        if (seen.has(hand)) {
          bag.add(`${path}.hands[${index}]`, `${hand} listed twice`);
        }
        seen.add(hand);
      });
      if (raw.caption !== undefined) bag.text(`${path}.caption`, raw.caption, 'caption');
      return;
    }

    case 'drill': {
      if (typeof raw.templateSlug !== 'string' || raw.templateSlug.length === 0) {
        bag.add(`${path}.templateSlug`, 'expected a template slug');
      }
      if (
        !Number.isInteger(raw.spots) ||
        (raw.spots as number) < 1 ||
        (raw.spots as number) > MAX_DRILL_SPOTS
      ) {
        bag.add(
          `${path}.spots`,
          `spots must be an integer in [1, ${MAX_DRILL_SPOTS}], got ${show(raw.spots)}`,
        );
      }

      if (context.templates !== undefined && typeof raw.templateSlug === 'string') {
        const known = context.templates.some((t) => t.slug === raw.templateSlug);
        if (!known) {
          bag.add(
            `${path}.templateSlug`,
            `no drill template named ${show(raw.templateSlug)} exists, so this block would have nothing to drill`,
          );
        }
      }
      return;
    }
  }
}

function checkLesson(
  bag: ErrorBag,
  path: string,
  raw: unknown,
  context: CurriculumContext,
): void {
  if (!isRecord(raw)) {
    bag.add(path, 'expected a lesson object');
    return;
  }

  bag.slug(`${path}.slug`, raw.slug);
  bag.text(`${path}.title`, raw.title, 'title');
  bag.text(`${path}.summary`, raw.summary, 'summary');
  bag.text(`${path}.version`, raw.version, 'version');
  bag.order(`${path}.sortOrder`, raw.sortOrder);

  if (!Array.isArray(raw.skillTags) || raw.skillTags.length === 0) {
    // Not pedantry: placement resolves a skill tag to a lesson, and weak-spot
    // detection resolves it the other way. An untagged lesson is unreachable by
    // both, which is a silent hole rather than an error.
    bag.add(`${path}.skillTags`, 'a lesson needs at least one skill tag');
  } else {
    raw.skillTags.forEach((tag, index) => {
      if (typeof tag !== 'string' || !SKILL_TAG.test(tag)) {
        bag.add(
          `${path}.skillTags[${index}]`,
          `expected a dotted slug like "preflop.rfi.utg", got ${show(tag)}`,
        );
      }
    });
  }

  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    bag.add(`${path}.blocks`, 'a lesson needs at least one block');
    return;
  }

  raw.blocks.forEach((block, index) => {
    checkBlock(bag, `${path}.blocks[${index}]`, block, context);
  });
}

function checkModule(
  bag: ErrorBag,
  path: string,
  raw: unknown,
  context: CurriculumContext,
): void {
  if (!isRecord(raw)) {
    bag.add(path, 'expected a module object');
    return;
  }

  bag.slug(`${path}.slug`, raw.slug);
  bag.text(`${path}.title`, raw.title, 'title');
  bag.order(`${path}.sortOrder`, raw.sortOrder);

  if (!Array.isArray(raw.lessons) || raw.lessons.length === 0) {
    bag.add(`${path}.lessons`, 'a module needs at least one lesson');
    return;
  }

  raw.lessons.forEach((lesson, index) => {
    checkLesson(bag, `${path}.lessons[${index}]`, lesson, context);
  });
  checkUniqueSlugs(bag, `${path}.lessons`, raw.lessons);
}

function checkTrack(
  bag: ErrorBag,
  path: string,
  raw: unknown,
  context: CurriculumContext,
): void {
  if (!isRecord(raw)) {
    bag.add(path, 'expected a track object');
    return;
  }

  bag.slug(`${path}.slug`, raw.slug);
  bag.text(`${path}.title`, raw.title, 'title');
  bag.order(`${path}.sortOrder`, raw.sortOrder);

  if (typeof raw.published !== 'boolean') {
    bag.add(`${path}.published`, `expected a boolean, got ${show(raw.published)}`);
  }
  if (raw.description !== undefined) {
    bag.text(`${path}.description`, raw.description, 'description');
  }

  if (!Array.isArray(raw.modules) || raw.modules.length === 0) {
    bag.add(`${path}.modules`, 'a track needs at least one module');
    return;
  }

  raw.modules.forEach((module, index) => {
    checkModule(bag, `${path}.modules[${index}]`, module, context);
  });
  checkUniqueSlugs(bag, `${path}.modules`, raw.modules);
}

export function validateTracks(
  data: unknown,
  context: CurriculumContext = {},
): CurriculumValidation {
  if (!Array.isArray(data)) {
    return { ok: false, errors: [{ path: '', message: 'expected an array of tracks' }] };
  }
  if (data.length === 0) {
    return { ok: false, errors: [{ path: '', message: 'expected at least one track' }] };
  }

  const bag = new ErrorBag();
  data.forEach((track, index) => checkTrack(bag, `[${index}]`, track, context));
  checkUniqueSlugs(bag, '', data);

  if (bag.errors.length > 0) return { ok: false, errors: bag.errors };

  return { ok: true, value: data as readonly Track[] };
}

/** As `validateTracks`, but throws a single error listing every problem. */
export function parseTracks(
  data: unknown,
  context: CurriculumContext = {},
): readonly Track[] {
  const result = validateTracks(data, context);
  if (result.ok) return result.value;

  const detail = result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
  throw new TypeError(`lesson content is invalid (${result.errors.length} problems):\n${detail}`);
}

/** Every lesson in the track, in reading order. Used by progression and the UI. */
export function orderedLessons(track: Track): readonly Lesson[] {
  return [...track.modules]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((module) => [...module.lessons].sort((a, b) => a.sortOrder - b.sortOrder));
}

/** The module a lesson belongs to, for breadcrumbs and the track rail. */
export function moduleOf(track: Track, lessonSlug: string): CurriculumModule | undefined {
  return track.modules.find((module) => module.lessons.some((l) => l.slug === lessonSlug));
}
