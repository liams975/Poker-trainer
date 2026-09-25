'use client';

import type { RangeChart } from '@poker/engine';

import { cn } from '@/lib/utils';
import { chartFamily, chartId, chartLabel } from '@/lib/charts/map';

/**
 * Grouped by family, because that is how the charts actually divide and how a
 * player thinks about them: "my opening ranges" and "defending my big blind"
 * are two different study sessions, not ten items in one list.
 */
const FAMILY_TITLES = {
  open: 'Opening (first in)',
  defend: 'Big blind defence',
  other: 'Other',
} as const;

export interface ChartSelectorProps {
  charts: readonly RangeChart[];
  selectedId: string;
  onSelect: (id: string) => void;
  label: string;
}

export function ChartSelector({ charts, selectedId, onSelect, label }: ChartSelectorProps) {
  const families = (['open', 'defend', 'other'] as const).map((family) => ({
    family,
    charts: charts.filter((chart) => chartFamily(chart) === family),
  }));

  return (
    <div
      className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-[8rem_minmax(0,1fr)]"
      role="group"
      aria-label={label}
    >
      {/* Visible, not just an aria-label: in compare mode two identical-looking
          selector blocks sit above each other, and which one drives which grid
          is not guessable from position alone. */}
      <p className="label-caps pt-1 text-ink md:row-span-3">{label}</p>
      {families
        .filter((group) => group.charts.length > 0)
        .map((group) => (
          <div key={group.family} className="flex flex-col gap-2 md:col-start-2">
            <p className="label-caps text-ink-muted">{FAMILY_TITLES[group.family]}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.charts.map((chart) => {
                const id = chartId(chart);
                const active = id === selectedId;

                return (
                  <button
                    key={id}
                    type="button"
                    // aria-pressed rather than styling alone: a toggle's state
                    // has to reach assistive tech, and the active border is not
                    // information a screen reader can see.
                    aria-pressed={active}
                    onClick={() => onSelect(id)}
                    className={cn(
                      'h-9 border px-3.5 text-sm transition-colors',
                      // Monochrome. docs/05 keeps amber for the streak and XP
                      // rail; the selector sits directly above the grid and
                      // borrowing it here would leak the one colour the grid
                      // must never show.
                      active
                        ? 'border-ink bg-ink text-canvas'
                        : 'border-line bg-surface-raised text-ink hover:border-ink',
                    )}
                  >
                    {chartLabel(chart)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}
