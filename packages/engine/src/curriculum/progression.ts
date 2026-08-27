/**
 * What is unlocked, and what comes next.
 *
 * Three screens read this — the track rail, the lesson view, and the
 * dashboard's Continue Learning card — so it is one pure function rather than a
 * rule re-derived in each. A rule implemented three times is a rule that will
 * eventually disagree with itself, and here the disagreement looks like a
 * lesson that is open on one screen and locked on another.
 *
 * The order is the *flattened* track: modules by `sortOrder`, lessons by
 * `sortOrder` within them. So "linear within a module, next module opens when
 * this one finishes" falls out of a single index rather than needing two rules.
 */

import type { Lesson, Track } from './lesson';
import { orderedLessons } from './lesson';

/** Mirrors the `lesson_status` enum. */
export const LESSON_STATUSES = ['locked', 'available', 'in_progress', 'completed'] as const;

export type LessonStatus = (typeof LESSON_STATUSES)[number];

/** One `lesson_progress` row, already resolved from lesson id to slug. */
export interface ProgressRow {
  lessonSlug: string;
  status: LessonStatus;
}

export interface ProgressionOptions {
  track: Track;
  progress: readonly ProgressRow[];
  /**
   * From `profiles.placement_skill_tag`. Opens everything up to and including
   * the lesson that teaches it. Never written by the client — see
   * docs/01-architecture.md §3: client-computed values must not unlock content.
   */
  placementSkillTag?: string | null | undefined;
}

/**
 * Where placement dropped the user, or 0 if they were never placed.
 *
 * A tag no lesson teaches places nobody: falling back to the start is the safe
 * direction, since the cost of an unknown tag should be re-reading material
 * rather than skipping it.
 */
function placementIndex(
  lessons: readonly Lesson[],
  placementSkillTag: string | null | undefined,
): number {
  if (!placementSkillTag) return 0;
  const index = lessons.findIndex((lesson) => lesson.skillTags.includes(placementSkillTag));
  return index >= 0 ? index : 0;
}

/**
 * The furthest lesson index the user may reach.
 *
 * Two inputs, and the frontier is the larger: one past whatever they have
 * actually finished, and wherever placement put them. Taking the maximum is
 * what stops a later, weaker placement from re-locking material somebody has
 * already worked through.
 */
function frontierIndex(
  lessons: readonly Lesson[],
  recorded: ReadonlyMap<string, LessonStatus>,
  placementSkillTag: string | null | undefined,
): number {
  let completedFrontier = 0;

  lessons.forEach((lesson, index) => {
    if (recorded.get(lesson.slug) === 'completed') {
      completedFrontier = Math.max(completedFrontier, index + 1);
    }
  });

  return Math.max(completedFrontier, placementIndex(lessons, placementSkillTag));
}

export function lessonStates(options: ProgressionOptions): ReadonlyMap<string, LessonStatus> {
  const lessons = orderedLessons(options.track);

  const recorded = new Map<string, LessonStatus>();
  for (const row of options.progress) recorded.set(row.lessonSlug, row.status);

  const frontier = frontierIndex(lessons, recorded, options.placementSkillTag);
  const states = new Map<string, LessonStatus>();

  lessons.forEach((lesson, index) => {
    const stored = recorded.get(lesson.slug);

    // A recorded completion or start is a fact about what the user did, and
    // outranks anything the ordering would infer.
    if (stored === 'completed' || stored === 'in_progress') {
      states.set(lesson.slug, stored);
      return;
    }

    states.set(lesson.slug, index <= frontier ? 'available' : 'locked');
  });

  return states;
}

/**
 * Where "Continue Learning" goes.
 *
 * The scan starts at the *placement* lesson, not at the top of the track. That
 * is the whole feature: a strong player who tested out of the basics and is
 * then sent to lesson one has been placed in name only.
 *
 * If everything from there on is finished, it falls back to scanning from the
 * start — so the basics they skipped are offered rather than the track
 * reporting itself complete when several lessons were never opened.
 *
 * An in-progress lesson is resumed rather than stepped over. Leaving something
 * half-read and being sent past it is the most annoying thing a course can do.
 */
export function nextLesson(options: ProgressionOptions): Lesson | undefined {
  const lessons = orderedLessons(options.track);
  const states = lessonStates(options);

  const resumable = (lesson: Lesson): boolean => {
    const status = states.get(lesson.slug);
    return status === 'available' || status === 'in_progress';
  };

  const from = placementIndex(lessons, options.placementSkillTag);
  return lessons.slice(from).find(resumable) ?? lessons.find(resumable);
}

export interface TrackSummary {
  total: number;
  completed: number;
  next: Lesson | undefined;
}

/** For the dashboard rail: how far through, and where to resume. */
export function trackProgress(options: ProgressionOptions): TrackSummary {
  const lessons = orderedLessons(options.track);
  const states = lessonStates(options);

  return {
    total: lessons.length,
    completed: lessons.filter((lesson) => states.get(lesson.slug) === 'completed').length,
    next: nextLesson(options),
  };
}
