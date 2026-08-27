import { trackProgress } from '@poker/engine';
import { redirect } from 'next/navigation';

import { ModeGrid } from '@/components/dashboard/mode-grid';
import { ProgressRail, type ProgressRailProps } from '@/components/dashboard/progress-rail';
import { TodayStrip } from '@/components/dashboard/today-strip';
import {
  fetchOnboardingCompleted,
  fetchReaderState,
  fetchTrack,
} from '@/lib/lessons/queries';

export const metadata = { title: 'Dashboard · Poker Trainer' };

/**
 * The study desk (docs/05-ui-ux.md).
 *
 * Six entry points rather than one linear journey, with progress present in the
 * rail but not dictating. The TODAY strip still reads zero because Phase 9
 * computes those numbers; the Progress section is real from Phase 8.
 *
 * A reader who has not been through onboarding is sent there once. The check
 * lives here rather than in `proxy.ts`, which runs on every request including
 * prefetches and is explicitly not the place for a database round trip.
 */
export default async function DashboardPage() {
  // Checked first, and outside the try below: whether to offer placement is a
  // question about this reader, not about the curriculum loading.
  if (!(await fetchOnboardingCompleted())) redirect('/onboarding');

  let rail: ProgressRailProps['track'];

  try {
    const { track, lessonIds } = await fetchTrack();
    const reader = await fetchReaderState(lessonIds);

    rail = {
      title: track.title,
      summary: trackProgress({
        track,
        progress: reader.progress,
        placementSkillTag: reader.placementSkillTag,
      }),
    };
  } catch {
    // The dashboard is the shell of the whole app; a content problem should
    // degrade one section of the rail rather than take the page down.
    rail = undefined;
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="sr-only">Dashboard</h1>

      <TodayStrip />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_18rem]">
        <ModeGrid />
        <ProgressRail track={rail} />
      </div>
    </div>
  );
}
