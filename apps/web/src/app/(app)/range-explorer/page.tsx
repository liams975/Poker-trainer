import { RangeExplorer } from '@/components/range/range-explorer';
import { fetchChartSet } from '@/lib/charts/queries';

export const metadata = { title: 'Range Explorer · Poker Trainer' };

/**
 * The first vertical slice: content authored in packages/content, synced to
 * Postgres, served through RLS, validated by the engine, rendered here.
 *
 * The fetch is server-side — the charts are the same for every signed-in user
 * and the session cookie is already on the request, so there is nothing to gain
 * from a round trip through the browser. If the load fails, error.tsx catches
 * it: there is deliberately no fallback to the bundled charts, because quietly
 * showing different ranges than the database holds is worse than showing none.
 */
export default async function RangeExplorerPage() {
  const chartSet = await fetchChartSet();

  return <RangeExplorer chartSet={chartSet} />;
}
