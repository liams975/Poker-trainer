import { lessonStates, orderedLessons } from '@poker/engine';

import type { LessonLink } from '@/components/nav/destinations';

import { fetchReaderState, fetchTrack } from './queries';

/**
 * The track, flattened to what a jump list needs.
 *
 * Deliberately reuses `lessonStates` rather than reimplementing "is this open".
 * The unlock rule already accounts for placement (Phase 8) and lives in the
 * engine precisely so two screens cannot arrive at different answers — a
 * palette that offers a lesson the track view shows as locked would be that
 * bug, in the least visible possible place.
 */
export async function lessonLinks(): Promise<readonly LessonLink[]> {
  const { track, lessonIds } = await fetchTrack();
  const reader = await fetchReaderState(lessonIds);

  const states = lessonStates({
    track,
    progress: reader.progress,
    placementSkillTag: reader.placementSkillTag,
  });

  return orderedLessons(track).map((lesson) => ({
    slug: lesson.slug,
    title: lesson.title,
    locked: states.get(lesson.slug) === 'locked',
  }));
}
