'use client';

import type { ChartSet, DrillTemplate } from '@poker/engine';

import { DrillRunner } from './drill-runner';

/**
 * A weak-spot session: the ordinary runner, started on a preset.
 *
 * The preset exists because there is nothing here to configure — which spots to
 * draw is the whole point, and it was decided by graded history rather than by
 * a form. Everything else is the same component, the same grading path and the
 * same write path as Quick Drill.
 *
 * A client component only because `preset` is an object and the runner is a
 * client component; the tags themselves were resolved on the server.
 */
export function WeakSpotRunner({
  chartSet,
  templates,
  focusTags,
}: {
  chartSet: ChartSet;
  templates: readonly { id: string; template: DrillTemplate }[];
  focusTags: readonly string[];
}) {
  return (
    <DrillRunner
      chartSet={chartSet}
      templates={templates.map((entry) => ({ id: entry.id, template: entry.template }))}
      mode="weak_spots"
      preset={{
        studyMode: false,
        length: 20,
        timed: false,
        // Every template: `focusTags` narrows the draw far better than a
        // template filter can, since a template covers a whole family of tags.
        templateSlugs: templates.map((entry) => entry.template.slug),
        focusTags,
      }}
    />
  );
}
