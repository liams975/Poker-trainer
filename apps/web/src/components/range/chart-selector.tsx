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
    <div className="flex flex-col gap-3" role="group" aria-label={label}>
      {/* Visible, not just an aria-label: in compare mode two identical-looking
          selector blocks sit above each other, and which one drives which grid
          is not guessable from position alone. */}
      <p className="font-display text-xs font-semibold text-ink">{label}</p>
      {families
        .filter((group) => group.charts.length > 0)
        .map((group) => (
          <div key={group.family} className="flex flex-col gap-1.5">
            <p className="text-xs uppercase tracking-wider text-ink-muted">
              {FAMILY_TITLES[group.family]}
            </p>
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
                      'rounded-[var(--radius)] border px-2.5 py-1 text-xs transition-colors',
                      // Monochrome. docs/05 keeps amber for the streak and XP
                      // rail; the selector sits directly above the grid and
                      // borrowing it here would leak the one colour the grid
                      // must never show.
                      active
                        ? 'border-ink bg-surface-raised text-ink'
                        : 'border-line bg-surface text-ink-muted hover:border-ink-muted hover:text-ink',
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
