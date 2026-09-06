'use client';

import type { ChartRegistry, HandNotation, RangeChart } from '@poker/engine';
import { chartSpot } from '@poker/engine';
import { useMemo } from 'react';

import { PokerTable } from '@/components/drill/poker-table';

/**
 * The spot a chart describes, drawn.
 *
 * The Range Explorer has named its spot in words since Phase 6 — "BB vs BTN
 * open" — and for anyone still learning, the words are the hard part. The
 * argument Phase 11 made for putting a table under the drill applies here with
 * more force, because this is the *study* screen: **position is geometry.**
 * "You are in the big blind facing a button open" means the raiser has position
 * on you for the rest of the hand and everyone else is already out, which you
 * read off a ring instantly and reconstruct from a label only by thinking.
 *
 * `chartSpot` is the same construction `explainChartHand` has used since Phase 6
 * to produce the rationale in the panel beside this. One state, not two: the
 * picture and the explanation cannot come to disagree about which spot is on
 * screen.
 *
 * Selecting a cell deals that hand into hero's seat, which is the moment the
 * whole thing pays off — `AKs` in the big blind, the button's 2.5bb already in
 * front of them.
 */
export function ChartSpotTable({
  chart,
  registry,
  hand,
}: {
  chart: RangeChart;
  registry: ChartRegistry;
  /** The selected cell, if any. Face-down cards until one is picked. */
  hand?: HandNotation | null;
}) {
  const spot = useMemo(() => {
    try {
      return chartSpot(chart, registry, hand ?? undefined);
    } catch {
      /**
       * A chart family with no opener chart to price the raise from cannot be
       * drawn — `openSizeFor` throws rather than inventing a size, and inventing
       * one would draw a spot that never happened.
       *
       * The same `try`/`catch` the rationale panel already uses, for the same
       * reason: the 169-cell grid beside this is still correct and is still the
       * important half.
       */
      return null;
    }
  }, [chart, registry, hand]);

  if (spot === null) return null;

  return (
    <div data-testid="chart-spot-table" data-hero={chart.heroPosition}>
      <PokerTable
        state={spot.state}
        hero={spot.hero}
        {...(hand
          ? {
              hole: [spot.scenario.hole[0], spot.scenario.hole[1]] as const,
              hand,
            }
          : {})}
        faceDownOpponents
      />
    </div>
  );
}
