'use client';

import type { ChartSet, HandNotation, RangeChart } from '@poker/engine';
import {
  createChartRegistry,
  diffCharts,
  explainChartHand,
  handStrategy,
} from '@poker/engine';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { chartId, chartLabel } from '@/lib/charts/map';

import { ActionLegend } from './action-legend';
import { ChartSelector } from './chart-selector';
import { HandDetail } from './hand-detail';
import { RangeGrid } from './range-grid';

/**
 * Free-form chart study. No grading, no scoring, no session — docs/02-roadmap
 * puts drilling in Phase 7, and this screen deliberately never marks you.
 *
 * The whole chart set arrives as a prop from the server component. All ten
 * charts are about 43KB of JSON, so switching charts and entering compare mode
 * are instant and offline-tolerant; fetching per selection would add a spinner
 * to every click for no benefit.
 */

/** BTN vs CO: the canonical "how does my range widen in position" comparison. */
function defaultComparison(charts: readonly RangeChart[]): string {
  const co = charts.find((c) => c.heroPosition === 'CO' && c.actionSequence === 'rfi');
  const fallback = charts[1] ?? charts[0]!;
  return chartId(co ?? fallback);
}

export function RangeExplorer({ chartSet }: { chartSet: ChartSet }) {
  const charts = chartSet.charts;

  const registry = useMemo(() => createChartRegistry(chartSet), [chartSet]);

  const [primaryId, setPrimaryId] = useState(() => {
    const btn = charts.find((c) => c.heroPosition === 'BTN' && c.actionSequence === 'rfi');
    return chartId(btn ?? charts[0]!);
  });
  const [comparisonId, setComparisonId] = useState(() => defaultComparison(charts));
  const [comparing, setComparing] = useState(false);
  const [selectedHand, setSelectedHand] = useState<HandNotation | null>(null);

  const primary = charts.find((c) => chartId(c) === primaryId) ?? charts[0]!;
  const comparison = charts.find((c) => chartId(c) === comparisonId) ?? charts[0]!;

  // Both directions, so each grid highlights against the other. diffCharts is
  // symmetric in distance but its deltas are signed from a towards b.
  const diff = useMemo(
    () => (comparing ? diffCharts(primary, comparison) : undefined),
    [comparing, primary, comparison],
  );
  const reverseDiff = useMemo(
    () => (comparing ? diffCharts(comparison, primary) : undefined),
    [comparing, primary, comparison],
  );

  const frequencies = selectedHand ? handStrategy(primary.ranges, selectedHand) : null;

  /**
   * Rationale comes from the engine, which replays the spot the chart describes
   * and asks the same ChartStrategy the drill will use. So the explanation here
   * cannot drift from the one Phase 7 grades against.
   */
  const rationale = useMemo(() => {
    if (!selectedHand) return null;
    try {
      return explainChartHand({
        chart: primary,
        hand: selectedHand,
        registry,
        chartVersion: chartSet.version,
      }).rationale;
    } catch {
      // A chart family with no opener chart to price the raise from cannot be
      // explained. The mix above is still correct and is the important half,
      // so show it without the "why" rather than failing the whole panel.
      return null;
    }
  }, [selectedHand, primary, registry, chartSet.version]);

  const actionsInChart = useMemo(() => {
    const present = new Set<string>();
    for (const entries of Object.values(primary.ranges)) {
      for (const entry of entries) present.add(entry.action);
    }
    // Absent hands fold, and the grid draws them, so fold is always shown.
    present.add('fold');
    return [...present] as never[];
  }, [primary]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-lg font-semibold">Range Explorer</h1>
          <p className="text-sm text-ink-muted">
            Every cell shows the full mix, not one action. Chart set {chartSet.version}.
          </p>
        </div>

        <Button
          type="button"
          variant={comparing ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={comparing}
          onClick={() => setComparing((on) => !on)}
        >
          {comparing ? 'Exit compare' : 'Compare charts'}
        </Button>
      </header>

      <div className="flex flex-col gap-4 rounded-[var(--radius)] border border-line bg-surface p-4">
        <ChartSelector
          charts={charts}
          selectedId={primaryId}
          onSelect={setPrimaryId}
          label={comparing ? 'Left chart' : 'Chart'}
        />

        {comparing ? (
          <>
            <hr className="border-line" />
            <ChartSelector
              charts={charts}
              selectedId={comparisonId}
              onSelect={setComparisonId}
              label="Right chart"
            />
          </>
        ) : null}
      </div>

      <ActionLegend actions={actionsInChart} />

      {comparing && diff ? (
        <p className="text-sm text-ink-muted" data-testid="diff-summary">
          {diff.changedCount === 0
            ? 'These two charts are identical.'
            : `${diff.changedCount} of 169 hands play differently.`}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]">
        <div
          className={
            comparing ? 'grid grid-cols-1 gap-6 2xl:grid-cols-2' : 'max-w-[46rem]'
          }
        >
          <RangeGrid
            chart={primary}
            label={chartLabel(primary)}
            selected={selectedHand}
            onSelect={setSelectedHand}
            diff={diff}
          />

          {comparing ? (
            <RangeGrid
              chart={comparison}
              label={chartLabel(comparison)}
              selected={selectedHand}
              onSelect={setSelectedHand}
              diff={reverseDiff}
            />
          ) : null}
        </div>

        <HandDetail
          hand={selectedHand}
          frequencies={frequencies}
          rationale={rationale}
          diff={
            comparing && diff && selectedHand
              ? diff.hands.find((h) => h.hand === selectedHand)
              : undefined
          }
          comparisonLabel={comparing ? chartLabel(comparison) : undefined}
        />
      </div>
    </div>
  );
}
