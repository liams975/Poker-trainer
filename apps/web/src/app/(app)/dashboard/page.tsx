import { trackProgress } from '@poker/engine';
import { redirect } from 'next/navigation';

import { ModeGrid } from '@/components/dashboard/mode-grid';
import { ProgressRail, type ProgressRailProps } from '@/components/dashboard/progress-rail';
import { TodayStrip } from '@/components/dashboard/today-strip';
import { getCharts } from '@/lib/charts/registry';
import {
  fetchOnboardingCompleted,
  fetchReaderState,
  fetchTrack,
} from '@/lib/lessons/queries';
import { fetchTodaySnapshot, type TodaySnapshot } from '@/lib/progress/queries';
import { skillLabel } from '@/lib/progress/skill-label';

export const metadata = { title: 'Dashboard · Poker Trainer' };

/**
 * The study desk (docs/05-ui-ux.md).
 *
 * Six entry points rather than one linear journey, with progress present in the
 * rail but not dictating. Every number on the page is derived from an event
 * table — nothing here reads a counter, and nothing here writes one.
 *
 * A reader who has not been through onboarding is sent there once. The check
 * lives here rather than in `proxy.ts`, which runs on every request including
 * prefetches and is explicitly not the place for a database round trip.
 *
 * Three independent reads, three independent failures. The track, the progress
 * figures and the charts that label them each degrade their own section rather
 * than taking the whole desk down — this is the shell of the app, and a stat
 * query that times out must not stop somebody starting a drill.
 */
export default async function DashboardPage() {
  // Checked first, and outside the try blocks below: whether to offer placement
  // is a question about this reader, not about the curriculum loading.
  if (!(await fetchOnboardingCompleted())) redirect('/onboarding');

  let rail: ProgressRailProps['track'];
  let snapshot: TodaySnapshot | null;
  let progress: ProgressRailProps['progress'];

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
    rail = undefined;
  }

  try {
    snapshot = await fetchTodaySnapshot();

    // Labels come from the charts that teach each tag, so the rail says
    // "BTN open" rather than `preflop.rfi.btn`. Resolved here because the rail
    // is a presentational component and the registry is a server concern.
    const { registry } = await getCharts();

    progress = {
      weakSpots: snapshot.weakSpots,
      recent: snapshot.recent,
      labels: Object.fromEntries(
        snapshot.weakSpots.map((spot) => [spot.skillTag, skillLabel(spot.skillTag, registry)]),
      ),
    };
  } catch {
    snapshot = null;
    progress = undefined;
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="sr-only">Dashboard</h1>

      <TodayStrip snapshot={snapshot} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_18rem]">
        <ModeGrid />
        <ProgressRail track={rail} progress={progress} />
      </div>
    </div>
  );
}
