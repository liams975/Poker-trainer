import { WEAK_SPOT_MIN_ATTEMPTS } from '@poker/engine';
import Link from 'next/link';

import { TrackEvent } from '@/components/analytics/track-event';
import { WeakSpotRunner } from '@/components/drill/weak-spot-runner';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchChartSet } from '@/lib/charts/queries';
import { getCharts } from '@/lib/charts/registry';
import { fetchDrillTemplates } from '@/lib/drills/queries';
import { fetchTodaySnapshot } from '@/lib/progress/queries';
import { skillLabel } from '@/lib/progress/skill-label';

export const metadata = { title: 'Weak Spots' };

/**
 * Weak Spots: adaptive sampling from the skills you are least sharp on.
 *
 * The tags come from `skill_stats`, which the server recomputes from
 * `drill_attempts` at the end of every scored session — so what is drilled here
 * is decided by graded history, never by the browser. A `?tag=` from the
 * dashboard rail narrows it to one skill, and is honoured only if it is
 * genuinely one of this user's weak spots: an arbitrary tag in the URL would
 * turn this into an undocumented focused drill.
 *
 * Empty is the ordinary state for a new account, and the copy says what would
 * change it rather than reporting nothing.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string | string[] }>;
}) {
  const [{ tag }, snapshot] = await Promise.all([searchParams, fetchTodaySnapshot()]);

  const requested = Array.isArray(tag) ? tag[0] : tag;
  const detected = snapshot.weakSpots.map((spot) => spot.skillTag);

  const focusTags =
    requested !== undefined && detected.includes(requested) ? [requested] : detected;

  if (focusTags.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-lg font-semibold">Weak spots</h1>

        <EmptyState>
          Nothing to work on yet. A skill needs {WEAK_SPOT_MIN_ATTEMPTS} answers before a low
          score means anything rather than a bad run.
        </EmptyState>

        <p className="text-sm text-ink-muted">
          <Link href="/drill/quick" className="text-ink underline underline-offset-4">
            Run a quick drill
          </Link>{' '}
          and check back.
        </p>
      </div>
    );
  }

  const [chartSet, templates, { registry }] = await Promise.all([
    fetchChartSet(),
    fetchDrillTemplates(),
    getCharts(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <TrackEvent event="weak_spots_opened" />

      <p className="text-sm text-ink-muted" data-testid="weak-spot-focus">
        Drilling {focusTags.map((skill) => skillLabel(skill, registry)).join(' · ')}.
      </p>

      <WeakSpotRunner
        chartSet={chartSet}
        templates={templates.map((entry) => ({ id: entry.id, template: entry.template }))}
        focusTags={focusTags}
      />
    </div>
  );
}
