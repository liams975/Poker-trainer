import { lessonStates, nextLesson, trackProgress } from '@poker/engine';
import Link from 'next/link';

import { TrackNav } from '@/components/lesson/track-nav';
import { Button } from '@/components/ui/button';
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
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-lg font-semibold">{track.title}</h1>
          <p className="text-sm text-ink-muted">
            {track.description} · {summary.completed} of {summary.total} lessons complete
          </p>
        </div>

        {next ? (
          <Button asChild>
            <Link href={`/learn/${next.slug}`}>
              {summary.completed === 0 ? 'Start' : 'Continue'}: {next.title}
            </Link>
          </Button>
        ) : (
          <p className="text-sm text-ink-muted">Track complete.</p>
        )}
      </header>

      {reader.placementSkillTag ? (
        <p className="text-sm text-ink-muted" data-testid="placement-note">
          Your placement opened everything up to your starting lesson. Earlier lessons are
          there if you want them.
        </p>
      ) : null}

      <TrackNav track={track} states={states} />
    </div>
  );
}
