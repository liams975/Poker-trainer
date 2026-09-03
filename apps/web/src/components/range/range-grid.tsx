'use client';

import type { ChartDiff, HandNotation, RangeChart } from '@poker/engine';
import { CANONICAL_HANDS, handStrategy } from '@poker/engine';
import { useCallback, useRef, useState } from 'react';

import { FrequencyCell } from './frequency-cell';

/**
 * The 13x13 matrix. CSS Grid and DOM, per docs/01-architecture.md — 169 cells
 * is trivial for the browser and canvas would cost keyboard access, text
 * selection and screen-reader support for nothing.
 *
 * Cell order comes from the engine's `CANONICAL_HANDS`, which is already
 * row-major with ranks descending, pairs on the diagonal, suited above it and
 * offsuit below. That constant exists precisely so this component holds no
 * poker knowledge (CLAUDE.md: never put poker logic in a React component).
 */

const SIDE = 13;

/**
 * `CANONICAL_HANDS` is already row-major with ranks descending, so chunking by
 * 13 gives the rows the ARIA grid pattern needs. The original flat index is
 * carried along because the roving tabindex, the diff and the cell refs are all
 * keyed on position in that one array.
 */
const ROWS: readonly (readonly { hand: HandNotation; index: number }[])[] = Array.from(
  { length: SIDE },
  (_, row) =>
    CANONICAL_HANDS.slice(row * SIDE, row * SIDE + SIDE).map((hand, column) => ({
      hand,
      index: row * SIDE + column,
    })),
);

export interface RangeGridProps {
  chart: RangeChart;
  selected: HandNotation | null;
  onSelect: (hand: HandNotation) => void;
  /** Compare mode. Indexed positionally against CANONICAL_HANDS. */
  diff?: ChartDiff | undefined;
  label: string;
}

export function RangeGrid({ chart, selected, onSelect, diff, label }: RangeGridProps) {
  /**
   * Roving tabindex: the grid is one tab stop, and arrows move within it.
   *
   * 169 individual tab stops would technically be "keyboard navigable" and
   * would in practice make the page unusable — 169 presses to get past the
   * grid. This is the pattern the ARIA grid role expects.
   */
  const [focusIndex, setFocusIndex] = useState(0);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);

  const moveTo = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(CANONICAL_HANDS.length - 1, index));
    setFocusIndex(clamped);
    cells.current[clamped]?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const row = Math.floor(focusIndex / SIDE);
      const col = focusIndex % SIDE;

      const moves: Record<string, number | undefined> = {
        ArrowRight: col < SIDE - 1 ? focusIndex + 1 : undefined,
        ArrowLeft: col > 0 ? focusIndex - 1 : undefined,
        ArrowDown: row < SIDE - 1 ? focusIndex + SIDE : undefined,
        ArrowUp: row > 0 ? focusIndex - SIDE : undefined,
        Home: row * SIDE,
        End: row * SIDE + SIDE - 1,
        PageUp: col,
        PageDown: (SIDE - 1) * SIDE + col,
      };

      const next = moves[event.key];
      if (next !== undefined) {
        event.preventDefault();
        moveTo(next);
        return;
      }

      // Enter and Space are the button's own activation, so they need no
      // handling here — letting them through keeps one code path for mouse
      // and keyboard selection.
    },
    [focusIndex, moveTo],
  );

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-display text-sm font-semibold">{label}</h3>

      <div
        role="grid"
        aria-label={`${label}, 13 by 13 starting hand matrix`}
        aria-rowcount={SIDE}
        aria-colcount={SIDE}
        className="grid w-full grid-cols-13 gap-px rounded-[var(--radius)] border border-line bg-line p-px"
      >
        {/*
          Rows are required, not decorative.
          `role="grid"` is only valid with `role="row"` between it and its
          gridcells — without them a screen reader announces 169 buttons with no
          row or column context at all, which for a matrix whose entire meaning
          is positional (rank by rank) is the difference between usable and
          not. axe flags it as two critical violations; jsx-a11y cannot see it,
          because it reads each component in isolation and the nesting is only
          wrong once they are composed.

          `display: contents` keeps the 13x13 CSS grid intact — the wrapper
          contributes semantics and no layout box. Modern engines preserve ARIA
          semantics through it; the browsers that dropped them predate this
          app's desktop-only target by years.
        */}
        {ROWS.map((row, rowIndex) => (
          <div key={rowIndex} role="row" className="contents">
            {row.map(({ hand, index }) => (
              <FrequencyCell
                key={hand}
                hand={hand}
                frequencies={handStrategy(chart.ranges, hand)}
                selected={selected === hand}
                focusable={index === focusIndex}
                diffDistance={diff?.hands[index]?.distance}
                onSelect={onSelect}
                onFocus={() => setFocusIndex(index)}
                onKeyDown={onKeyDown}
                cellRef={(node) => {
                  cells.current[index] = node;
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
