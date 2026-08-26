import type { ChartSet } from '@poker/engine';

import { createClient } from '@/lib/supabase/server';

import { toChartSet, type ChartSetRow } from './map';

/**
 * Loads the published chart set from Supabase.
 *
 * This is the vertical slice the roadmap asks Phase 6 to prove: content
 * authored in `packages/content`, synced to Postgres by `pnpm content:sync`,
 * served through RLS, validated by the engine, rendered by React.
 *
 * RLS does the filtering. Phase 4's policies gate `range_charts` on the parent
 * set's `published` flag, so an unpublished set is invisible here without this
 * query saying anything about it — which is the point of putting the rule in
 * the database rather than in a WHERE clause somebody can forget.
 *
 * No fallback to the bundled `@poker/content` charts on failure. Quietly
 * serving different charts than the database holds would make "retune without
 * a deploy" a lie, and the user would have no way to tell which they were
 * looking at. A failure is an error state.
 */
export async function fetchChartSet(): Promise<ChartSet> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('range_chart_sets')
    .select(
      `version, published, notes,
       range_charts (table_size, stack_depth, hero_position, action_sequence, ranges, skill_tags)`,
    )
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`could not load range charts: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      'no published chart set is visible. Run `pnpm content:sync` against this database.',
    );
  }

  // Validated here, not trusted. See map.ts for why.
  return toChartSet(data as unknown as ChartSetRow);
}
