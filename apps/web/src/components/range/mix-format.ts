import type { ActionFreq, HandNotation } from '@poker/engine';

import { ACTION_ORDER, actionLabel } from './action-colors';

/**
 * Formatting a mixed strategy for display and for assistive technology.
 *
 * Deliberately a plain module rather than living inside the cell component:
 * the e2e suite imports `describeMix` to compute what each of the 169 cells
 * *should* say and compares it against what the DOM actually says. Importing
 * that from a `.tsx` would drag JSX and the `@/` path alias into Playwright's
 * loader, and the alternative — the test reimplementing the formatting — would
 * make it possible for both sides to be wrong in the same way.
 */

/** Sorts a distribution into the grid's fixed segment order. */
export function orderedMix(frequencies: readonly ActionFreq[]): readonly ActionFreq[] {
  return [...frequencies].sort((a, b) => {
    const byAction = ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action);
    // Two raise sizings in one hand: smaller first, so the order is total and
    // the bar does not reshuffle between renders.
    return byAction !== 0 ? byAction : (a.size ?? 0) - (b.size ?? 0);
  });
}

function percent(freq: number): string {
  // A 0.4% raise is strategically different from never raising, so it renders
  // as "<1%" rather than rounding to "0%" and reading as never.
  const value = freq * 100;
  return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`;
}

/** e.g. `AJo: Fold 40%, Raise 2.5bb 60%`. The cell's accessible name. */
export function describeMix(hand: HandNotation, frequencies: readonly ActionFreq[]): string {
  const parts = orderedMix(frequencies).map(
    (entry) => `${actionLabel(entry.action, entry.size)} ${percent(entry.freq)}`,
  );
  return `${hand}: ${parts.join(', ')}`;
}
