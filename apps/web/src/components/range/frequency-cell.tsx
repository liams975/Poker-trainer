import type { ActionFreq, HandNotation } from '@poker/engine';

import { cn } from '@/lib/utils';

import { actionStyle } from './action-colors';
import { describeMix, orderedMix } from './mix-format';

/**
 * The signature element (docs/05-ui-ux.md).
 *
 * A cell is **not a solid colour**. It is a stacked bar rendering the hand's
 * actual mixed strategy: `AJo` at 60% open / 40% fold draws as 60% vermilion,
 * 40% grey, within the cell.
 *
 * Most range-chart UIs fill each cell with the single dominant action. That
 * design teaches a lie — it says `AJo` *is* a raise when it is a frequency. The
 * stacked cell makes mixed strategy visible across the entire grid at a glance,
 * which is the single most important concept this app exists to teach.
 *
 * Three encodings, so colour is never load-bearing on its own (CLAUDE.md):
 *   - hue, from the Okabe-Ito palette
 *   - proportion, which survives any colour vision deficiency and greyscale
 *   - fixed left-to-right order, passive to aggressive, identical in every cell
 * plus an accessible name spelling the mix out in words for screen readers.
 */

export interface FrequencyCellProps {
  hand: HandNotation;
  frequencies: readonly ActionFreq[];
  selected: boolean;
  /** Roving tabindex: exactly one cell in the grid is reachable by Tab. */
  focusable: boolean;
  /** Compare mode. 0 means identical; drives the highlight, not the colour. */
  diffDistance?: number | undefined;
  onSelect: (hand: HandNotation) => void;
  onFocus: (hand: HandNotation) => void;
  /**
   * Arrow-key navigation lives on the cell rather than on the grid container.
   * The container carries `role="grid"` but is deliberately not focusable — in
   * a roving-tabindex grid the cells hold focus — so hanging a key handler
   * there would attach it to an element that can never be the event target,
   * relying on bubbling. Here it is on the element that is actually focused.
   */
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  cellRef?: ((node: HTMLButtonElement | null) => void) | undefined;
}

export function FrequencyCell({
  hand,
  frequencies,
  selected,
  focusable,
  diffDistance,
  onSelect,
  onFocus,
  onKeyDown,
  cellRef,
}: FrequencyCellProps) {
  const segments = orderedMix(frequencies);
  // `undefined` means not comparing at all, which must not dim anything.
  const unchanged = diffDistance !== undefined && diffDistance === 0;
  /**
   * The corner figure: the share of the right-hand segment, printed only when
   * the hand mixes. A pure cell needs no number — its colour already says
   * "always" — so the figures that do appear are exactly the hands the app
   * exists to teach, and a mixed region reads as a mixed region in type as
   * well as in colour.
   *
   * Always the right-hand segment, because the order is fixed passive → aggres-
   * sive in every cell: "50" in a raise/fold cell and "55" in a raise/call cell
   * both mean the aggressive share, read the same way everywhere.
   */
  const mixFigure =
    segments.length > 1 ? Math.round((segments[segments.length - 1]?.freq ?? 0) * 100) : null;

  return (
    <button
      ref={cellRef}
      type="button"
      role="gridcell"
      // The mix in words. The only encoding that reaches a screen reader, and
      // the one the e2e suite reads back to prove the grid renders the chart
      // rather than merely rendering 169 cells.
      aria-label={describeMix(hand, frequencies)}
      aria-selected={selected}
      data-hand={hand}
      data-mix={describeMix(hand, frequencies)}
      tabIndex={focusable ? 0 : -1}
      onClick={() => onSelect(hand)}
      onFocus={() => onFocus(hand)}
      onKeyDown={onKeyDown}
      className={cn(
        // A size container, so the type inside scales with the cell rather
        // than the viewport: the same component draws at 25px beside a
        // solution and at 44px in the explorer.
        '@container relative isolate block overflow-hidden',
        'aspect-square w-full min-w-0 select-none',
        'font-mono leading-none tracking-[-0.02em]',
        // The label sits above the bar and must stay readable over every hue in
        // the palette, so it carries its own shadow rather than relying on the
        // segment beneath it being dark.
        'text-ink [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]',
        // Monochrome, never the accent. docs/05 reserves amber for the streak
        // and XP rail and says it must "never appear in a range grid" — an
        // amber wash across 73 changed cells reads as a sixth action and makes
        // the Okabe-Ito palette stop meaning what it means.
        selected && 'z-10 ring-2 ring-ink ring-offset-1 ring-offset-canvas',
        // Compare mode inverts the usual highlight: rather than painting what
        // changed, it fades what did not, so the eye lands on the difference
        // without a single new hue entering the grid.
        unchanged && 'opacity-30',
      )}
    >
      <span aria-hidden="true" className="absolute inset-0 -z-10 flex">
        {segments.map((entry) => (
          <span
            key={`${entry.action}-${entry.size ?? ''}`}
            style={{
              width: `${entry.freq * 100}%`,
              backgroundColor: actionStyle(entry.action).hex,
            }}
          />
        ))}
      </span>

      {/* Top-left, like an element in a periodic table: the grid is a
          specimen chart, and the corner is where the eye looks for a name. */}
      <span className="absolute left-[9%] top-[8%] text-[clamp(0.5rem,26cqw,0.75rem)]">{hand}</span>

      {mixFigure !== null ? (
        // aria-hidden: the accessible name above already spells the whole mix
        // out. Hidden in cells too small to carry two labels legibly.
        <span
          aria-hidden="true"
          className="absolute bottom-[8%] right-[8%] text-[clamp(0.5rem,22cqw,0.6875rem)] @max-[2.1rem]:hidden"
        >
          {mixFigure}
        </span>
      ) : null}
    </button>
  );
}
