import { trackProgress } from '@poker/engine';
import { redirect } from 'next/navigation';

import type { DayPoint } from '@poker/engine';

import { MasterySummary } from '@/components/dashboard/mastery-summary';
import { NextUp } from '@/components/dashboard/next-up';
import { ModeGrid } from '@/components/dashboard/mode-grid';
import { ProgressRail, type ProgressRailProps } from '@/components/dashboard/progress-rail';
import { TodayStrip } from '@/components/dashboard/today-strip';
import { EvLossChart } from '@/components/review/ev-loss-chart';
import { SectionHead } from '@/components/ui/section-head';
import { getCharts } from '@/lib/charts/registry';
import {
  fetchOnboardingCompleted,
  fetchReaderState,
  fetchTrack,
} from '@/lib/lessons/queries';
import { fetchMasterySnapshot } from '@/lib/progress/mastery-queries';
import { fetchReviewHistory } from '@/lib/review/queries';
import { fetchTodaySnapshot, type TodaySnapshot } from '@/lib/progress/queries';
import type { MasterySnapshot } from '@/lib/progress/types';
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
  let mastery: MasterySnapshot | null;
  let history: readonly DayPoint[] | null;

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

  // A fourth independent read, and a fourth independent failure. Rank and
  // mastery are derived from the whole attempt log rather than from the day's
  // snapshot, so this is genuinely a different query and gets its own guard.
  try {
    const { registry } = await getCharts();
    mastery = await fetchMasterySnapshot(registry);
  } catch {
    mastery = null;
  }

  // A fifth, for the record. The same query and chart Session Review uses —
  // one reading of EV lost over time, drawn twice, rather than a second one
  // that could come to disagree with it.
  try {
    history = (await fetchReviewHistory()).points;
  } catch {
    history = null;
  }

  // The contents list's figures, where the Desk has the real number.
  const figures: Record<string, string> = {};
  if (rail) figures['continue-learning'] = `${rail.summary.completed} / ${rail.summary.total}`;
  if (progress && progress.weakSpots.length > 0) {
    figures['weak-spots'] = `${progress.weakSpots.length} ${progress.weakSpots.length === 1 ? 'skill' : 'skills'}`;
  }

  return (
    <div className="flex flex-col gap-24">
      <h1 className="sr-only">Dashboard</h1>

      {/* The masthead: one obvious next action, set large, with the day's
          readings beside it like an instrument panel. */}
      <div className="grid grid-cols-1 gap-16 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <NextUp track={rail?.summary} />
        <TodayStrip snapshot={snapshot} />
      </div>

      <div className="grid grid-cols-1 gap-16 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <section aria-labelledby="practice-heading" className="flex flex-col">
          <SectionHead n={1} id="practice-heading" title="Practice" caption="seven ways in" />
          <ModeGrid figures={figures} />
        </section>
        <div className="pt-3">
          <ProgressRail track={rail} progress={progress} />
        </div>
      </div>

      {history === null ? null : (
        <section aria-labelledby="record-heading" className="flex flex-col gap-8">
          <SectionHead n={2} id="record-heading" title="The record" caption="last 30 days" />
          <EvLossChart
            points={history}
            id="desk-ev"
            caption={{
              figure: 'Fig. 1',
              text: 'bb lost per spot, one dot a day, the seven-day mean behind it. Zero is at the top, so a higher dot is a better day. Hatched columns are days with no practice — a gap, never a zero.',
            }}
          />
        </section>
      )}

      <MasterySummary snapshot={mastery} />
    </div>
  );
}
