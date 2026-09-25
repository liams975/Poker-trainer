import { lessonStates, orderedLessons } from '@poker/engine';
import { notFound } from 'next/navigation';

import { LessonView } from '@/components/lesson/lesson-view';
import { TrackNav } from '@/components/lesson/track-nav';
import { fetchChartSet } from '@/lib/charts/queries';
import { fetchDrillTemplates } from '@/lib/drills/queries';
import { fetchReaderState, fetchTrack } from '@/lib/lessons/queries';

/**
 * One lesson, with the track beside it.
 *
 * A locked lesson 404s rather than rendering. The server is the authority on
 * what is open — `lib/lessons/record.ts` refuses to record progress on a locked
 * lesson too, so the two agree — and rendering it with a disabled button would
 * put the content on screen while claiming it was not available.
 *
 * `params` is a Promise in Next 16.
 */
export default async function Page({ params }: { params: Promise<{ lesson: string }> }) {
  const { lesson: lessonSlug } = await params;

  const [{ track, lessonIds }, chartSet, templates] = await Promise.all([
    fetchTrack(),
    fetchChartSet(),
    fetchDrillTemplates(),
  ]);

  const lessons = orderedLessons(track);
  const index = lessons.findIndex((entry) => entry.slug === lessonSlug);
  const lesson = lessons[index];
  if (lesson === undefined) notFound();

  const reader = await fetchReaderState(lessonIds);
  const states = lessonStates({
    track,
    progress: reader.progress,
    placementSkillTag: reader.placementSkillTag,
  });

  const status = states.get(lessonSlug) ?? 'locked';
  if (status === 'locked') notFound();

  return (
    <div className="grid grid-cols-1 gap-16 xl:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 xl:sticky xl:top-8 xl:max-h-[calc(100dvh-4rem)] xl:self-start xl:overflow-y-auto">
        <p className="flex flex-col gap-2">
          <span className="label-caps text-ink">Contents</span>
          <span className="font-display text-2xl">{track.title}</span>
        </p>
        <TrackNav track={track} states={states} activeSlug={lessonSlug} />
      </aside>

      <LessonView
        track={track}
        lesson={lesson}
        status={status}
        chartSet={chartSet}
        templates={templates.map((entry) => ({ id: entry.id, template: entry.template }))}
        nextLessonSlug={lessons[index + 1]?.slug ?? null}
      />
    </div>
  );
}
