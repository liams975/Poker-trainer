import { fetchChartSet } from '@/lib/charts/queries';
import { fetchDrillTemplates } from '@/lib/drills/queries';

import { DrillRunner } from './drill-runner';

/**
 * The server half of a drill screen: load the content, hand it to the runner.
 *
 * Both charts and templates arrive as props rather than being fetched per spot.
 * Ten charts and eight templates are about 45KB together, so a session never
 * touches the network to *present* a spot — only to record the answer. That is
 * what keeps the feedback moment under docs/05's 100ms whatever the connection
 * is doing.
 *
 * Auth is the `(app)` layout's `requireUser()`, and RLS underneath it. Nothing
 * here re-implements either.
 */
export async function DrillPage({ mode }: { mode: 'quick' | 'focused' }) {
  const [chartSet, templates] = await Promise.all([fetchChartSet(), fetchDrillTemplates()]);

  return (
    <DrillRunner
      chartSet={chartSet}
      templates={templates.map((entry) => ({ id: entry.id, template: entry.template }))}
      mode={mode}
    />
  );
}
