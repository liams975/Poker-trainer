import type { Action } from '@poker/engine';

import { ACTION_ORDER, actionStyle } from './action-colors';

/**
 * Where the glyph-and-label half of the colour rule lives.
 *
 * CLAUDE.md requires that every action carry a glyph or label as well as a
 * hue. At a 44px grid cell a per-segment glyph is not legible, so the cells
 * encode with hue plus proportion plus fixed order, and the naming happens
 * here, in the focused-cell readout, and in the hand detail panel.
 */
export function ActionLegend({ actions }: { actions: readonly Action[] }) {
  // Only the actions this chart actually uses. A legend listing all six when
  // the chart is raise-or-fold is noise that makes the two that matter harder
  // to find.
  const present = ACTION_ORDER.filter((action) => actions.includes(action));

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Action colours">
      {present.map((action) => {
        const style = actionStyle(action);
        return (
          <li key={action} className="flex items-center gap-2 text-sm text-ink">
            <span
              aria-hidden="true"
              className="inline-block size-3"
              style={{ backgroundColor: style.hex }}
            />
            <span aria-hidden="true" className="w-3 font-mono text-ink-muted">
              {style.glyph}
            </span>
            <span>{style.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
