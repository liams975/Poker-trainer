import type { CurriculumContext, Track } from '@poker/engine';
import { parseTracks } from '@poker/engine';

/**
 * Turning `tracks` / `modules` / `lessons` rows into a validated `Track`.
 *
 * Same reasoning as lib/charts/map.ts and lib/drills/map.ts: `lessons.body` is
 * an opaque jsonb blob written by a service-role script, so it goes through the
 * engine's own `parseTracks` rather than being trusted.
 *
 * It matters more here than for a chart. A malformed chart renders a wrong
 * range and a careful reader might notice; a lesson block naming a chart that
 * does not exist renders an empty box, and the reader assumes the blank space
 * is the point. Passing the registry and templates is what turns that into a
 * loud failure.
 */

export interface LessonRow {
  id: string;
  slug: string;
  title: string;
  body: unknown;
  skill_tags: string[] | null;
  sort_order: number;
  version: string;
}

export interface ModuleRow {
  slug: string;
  title: string;
  sort_order: number;
  lessons: LessonRow[];
}

export interface TrackRow {
  slug: string;
  title: string;
  description: string | null;
  sort_order: number;
  published: boolean;
  modules: ModuleRow[];
}

export interface StoredTrack {
  track: Track;
  /** Lesson slug to database id. `lesson_progress.lesson_id` is a uuid. */
  lessonIds: ReadonlyMap<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toTrack(row: TrackRow, context: CurriculumContext = {}): StoredTrack {
  const candidate = {
    slug: row.slug,
    title: row.title,
    ...(row.description === null ? {} : { description: row.description }),
    sortOrder: row.sort_order,
    published: row.published,
    modules: row.modules.map((module) => ({
      slug: module.slug,
      title: module.title,
      sortOrder: module.sort_order,
      lessons: module.lessons.map((lesson) => {
        const body = isRecord(lesson.body) ? lesson.body : {};

        return {
          slug: lesson.slug,
          title: lesson.title,
          // `summary` and `blocks` live inside body; everything else is a
          // first-class column. Spreading body would let it shadow them.
          summary: body.summary,
          blocks: body.blocks,
          skillTags: lesson.skill_tags ?? [],
          sortOrder: lesson.sort_order,
          version: lesson.version,
        };
      }),
    })),
  };

  const [track] = parseTracks([candidate], context);

  const lessonIds = new Map<string, string>();
  for (const module of row.modules) {
    for (const lesson of module.lessons) lessonIds.set(lesson.slug, lesson.id);
  }

  return { track: track!, lessonIds };
}
