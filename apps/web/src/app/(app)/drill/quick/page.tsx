import { DrillPage } from '@/components/drill/drill-page';

/**
 * Quick Drill: mixed spots from every published template, low friction.
 *
 * A static route rather than `/drill/[mode]`, so `/drill/weak-spots` — which
 * the dashboard already links to and Phase 9 will build — 404s by construction
 * instead of relying on a whitelist someone has to remember to update.
 */
export const metadata = { title: 'Quick Drill' };

export default function Page() {
  return <DrillPage mode="quick" />;
}
