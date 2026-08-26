import type { ChartRegistry, ChartSet } from '@poker/engine';
import { createChartRegistry } from '@poker/engine';

import { fetchChartSet } from './queries';

/**
 * A short-lived server-side memo of the chart set and its registry.
 *
 * Grading runs in a Server Action (see lib/drills/actions.ts), and each Server
 * Action invocation is its own request — so React `cache()`, which is
 * per-request, does not span them. Without a memo, a 25-spot session refetches
 * and revalidates the same 43KB of charts 25 times.
 *
 * Staleness is safe here in a way it usually is not, because `chartVersion`
 * travels *with* the cached set. An attempt graded from a slightly stale
 * registry is graded consistently against those charts and records the version
 * it actually used, so `drill_attempts` stays interpretable — which is the
 * whole reason the column exists. The failure this prevents is the real one:
 * grading against version B while recording version A.
 *
 * Charts only change when someone runs `pnpm content:sync`, so a minute of
 * staleness costs nothing.
 */
const TTL_MS = 60_000;

export interface CachedCharts {
  chartSet: ChartSet;
  registry: ChartRegistry;
}

let cached: { at: number; value: Promise<CachedCharts> } | undefined;

export function clearChartCache(): void {
  cached = undefined;
}

export async function getCharts(): Promise<CachedCharts> {
  const now = Date.now();

  if (cached !== undefined && now - cached.at < TTL_MS) {
    return cached.value;
  }

  // The promise is cached, not the resolved value, so concurrent callers during
  // a cold start share one fetch instead of stampeding the database.
  const value = fetchChartSet().then((chartSet) => ({
    chartSet,
    registry: createChartRegistry(chartSet),
  }));

  cached = { at: now, value };

  // A failed fetch must not be remembered for a minute, or one blip takes the
  // drill runner down for far longer than the outage itself.
  value.catch(() => {
    if (cached?.value === value) cached = undefined;
  });

  return value;
}
