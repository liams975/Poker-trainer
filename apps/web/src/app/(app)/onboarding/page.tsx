import { redirect } from 'next/navigation';

import { TrackEvent } from '@/components/analytics/track-event';
import { PlacementFlow } from '@/components/onboarding/placement-flow';
import { fetchChartSet } from '@/lib/charts/queries';
import { fetchDrillTemplates } from '@/lib/drills/queries';
import { fetchTrack, fetchReaderState } from '@/lib/lessons/queries';

/**
 * The placement diagnostic.
 *
 * Protected like everything else under `(app)`: `lib/auth/routes.ts` is a
 * deny-by-default list of *public* prefixes, so a route added here is guarded
 * the moment it exists rather than when somebody remembers to register it.
 *
 * Someone who has already been placed is sent on. Re-running the diagnostic
 * would overwrite a placement they have since worked past, and the unlock rule
 * takes the maximum of placement and progress precisely so that cannot happen —
 * but there is no reason to offer the trip.
 */
export const metadata = { title: 'Getting started' };

export default async function Page() {
  const [{ lessonIds }, chartSet, templates] = await Promise.all([
    fetchTrack(),
    fetchChartSet(),
    fetchDrillTemplates(),
  ]);

  const reader = await fetchReaderState(lessonIds);
  if (reader.onboardingCompleted) redirect('/learn');

  return (
    <>
      <TrackEvent event="onboarding_started" />
      <PlacementFlow
        chartSet={chartSet}
        templates={templates.map((entry) => ({ id: entry.id, template: entry.template }))}
      />
    </>
  );
}
