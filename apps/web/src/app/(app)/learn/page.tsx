import { lessonStates, nextLesson, trackProgress } from '@poker/engine';
import Link from 'next/link';

import { TrackNav } from '@/components/lesson/track-nav';
import { Button } from '@/components/ui/button';
import { SectionHead } from '@/components/ui/section-head';
import { fetchReaderState, fetchTrack } from '@/lib/lessons/queries';

/**
 * The track overview: where you are, and where to carry on.
 *
 * Both the unlock states and the resume point come from the engine's
 * `progression` module, which is also what the lesson page and the dashboard
 * rail read — so a lesson cannot be open here and locked there.
 */
export const metadata = { title: 'Learn' };

export default async function Page() {
  const { track, lessonIds } = await fetchTrack();
  const reader = await fetchReaderState(lessonIds);

  const options = {
    track,
    progress: reader.progress,
    placementSkillTag: reader.placementSkillTag,
  };

  const states = lessonStates(options);
  const summary = trackProgress(options);
  const next = nextLesson(options);

  return (
    <div className="flex flex-col gap-16">
      <header className="flex flex-col">
        <span className="label-caps text-ink-muted">The course · {summary.completed} of {summary.total} lessons complete</span>
        <h1 className="mt-7 font-display text-6xl tracking-[-0.02em]">{track.title}</h1>
        <p className="mt-6 max-w-[40rem] text-xl text-ink-muted">{track.description}</p>

        <div className="mt-10 flex flex-wrap items-center gap-6">
          {next ? (
            <Button asChild className="h-13 px-6">
              <Link href={`/learn/${next.slug}`}>
                {summary.completed === 0 ? 'Start' : 'Continue'}: {next.title} →
              </Link>
            </Button>
          ) : (
            <p className="label-caps text-ink">Track complete.</p>
          )}
        </div>
      </header>

      {reader.placementSkillTag ? (
        <p className="text-sm text-ink-muted" data-testid="placement-note">
          Your placement opened everything up to your starting lesson. Earlier lessons are
          there if you want them.
        </p>
      ) : null}

      <section aria-labelledby="contents-heading" className="flex flex-col gap-10">
        <SectionHead id="contents-heading" title="Contents" caption="● done · ◐ in progress · ○ not started · · locked" />
        <TrackNav track={track} states={states} layout="columns" />
      </section>
    </div>
  );
}
