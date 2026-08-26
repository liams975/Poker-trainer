import type { DrillSpot } from '@poker/engine';
import { potSize } from '@poker/engine';

import { ActionHistory } from './action-history';
import { HoleCards } from './hole-cards';
import { TableSeats } from './table-seats';

/**
 * The left column: the spot itself.
 *
 * docs/05-ui-ux.md's first named desktop advantage is that this stays on screen
 * while the feedback appears beside it — "on mobile this must be a modal that
 * hides the spot. Here the user sees the decision *and* the chart
 * simultaneously." So nothing in here collapses or is replaced on reveal.
 */
export function SpotView({ spot, children }: { spot: DrillSpot; children?: React.ReactNode }) {
  const { state, hero, scenario } = spot;

  return (
    <div className="flex flex-col gap-5 rounded-[var(--radius)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-sm font-semibold">
            You are {hero} · {scenario.stackDepth}bb
          </h2>
          <p className="font-mono text-xs text-ink-muted">
            Pot {potSize(state)}bb
          </p>
        </div>

        <HoleCards hole={scenario.hole} hand={scenario.hand} />
      </div>

      <TableSeats state={state} hero={hero} />
      <ActionHistory state={state} />

      {children}
    </div>
  );
}
