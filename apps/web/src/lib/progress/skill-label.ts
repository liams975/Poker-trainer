import type { ChartRegistry } from '@poker/engine';

import { chartLabel } from '@/lib/charts/map';

/**
 * A skill tag, in words.
 *
 * Resolved from the chart registry rather than from a lookup table kept
 * alongside it. Every drillable tag is carried by the chart that teaches it,
 * authored in the same file as the range — so `preflop.rfi.btn` becomes
 * "BTN open" because that is what the chart is called, and a tag added to
 * content in future is labelled without anybody remembering to edit this file.
 *
 * A parallel map would be a second source of truth for the same fact, and the
 * two would disagree the first time a chart was renamed.
 */
export function skillLabel(skillTag: string, registry: ChartRegistry): string {
  for (const chart of registry.values()) {
    if (chart.skillTags.includes(skillTag)) return chartLabel(chart);
  }

  /**
   * `concept.*` tags name ideas rather than spots, so no chart carries them.
   * Turning the tag itself into a phrase beats showing a dotted identifier,
   * and beats inventing a label nobody authored.
   */
  const leaf = skillTag.split('.').at(-1) ?? skillTag;

  return leaf.replace(/_/g, ' ').replace(/^./, (first) => first.toUpperCase());
}
