'use client';

import type { HandNotation, RangeChart } from '@poker/engine';
import { CANONICAL_HANDS, comboCount, comboCountOf, handStrategy, toWeights } from '@poker/engine';
import { useState } from 'react';

import { actionLabel, actionStyle } from '@/components/range/action-colors';
import { describeMix, orderedMix, percent } from '@/components/range/mix-format';
import { RangeGrid } from '@/components/range/range-grid';

/** Every two-card holding, counted from the engine's own hand list. */
const ALL_COMBOS = CANONICAL_HANDS.reduce((total, hand) => total + comboCountOf(hand), 0);

/** Where a seat is, in words — the notation belongs in the grid, not the prose. */
const SEAT_PHRASE: Readonly<Record<string, string>> = {
  UTG: 'under the gun',
  HJ: 'in the hijack',
  CO: 'in the cutoff',
  BTN: 'on the button',
  SB: 'in the small blind',
  BB: 'in the big blind',
};

/** One decimal, the way the lessons quote a range's width: 43.4%, not 43%. */
function width(combos: number): string {
  return `${((combos / ALL_COMBOS) * 100).toFixed(1)}%`;
}

/**
 * The one thing on the signed-out pages that is not a claim.
 *
 * A screenshot would be smaller and it would also be a picture of software
 * rather than the software. This is the real grid component, driven by a real
 * seeded chart, and it is interactive — clicking a hand shows its actual mix in
 * the margin beside it, the way a figure in a book carries its note.
 *
 * Opens on `A5o`, which the button chart plays exactly half and half. The
 * landing page said "AJo opens 64% of the time on the button" for five phases;
 * the chart has AJo as a pure raise, so the sentence illustrated the opposite
 * of its own point. The opening hand is now one the chart genuinely mixes.
 */
export function HeroGrid({
  chart,
  label,
  figure = 'Fig. 1',
}: {
  chart: RangeChart;
  label: string;
  figure?: string;
}) {
  const [selected, setSelected] = useState<HandNotation>('A5o');

  const frequencies = handStrategy(chart.ranges, selected);
  const mix = orderedMix(frequencies);
  const combos = comboCount(toWeights(chart.ranges));

  return (
    <figure className="m-0 flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-6">
        <div className="w-full max-w-[29rem]">
          <RangeGrid chart={chart} selected={selected} onSelect={setSelected} label={label} />
        </div>

        {/* The margin note for the selected hand. Hues here are strategy data
            — the same stacked bar the cell draws, at a readable size — and
            every segment is named beside its glyph. */}
        <div className="flex w-60 flex-col gap-3 pt-7" aria-live="polite">
          <p className="font-mono text-base text-ink">
            {selected}, {SEAT_PHRASE[chart.heroPosition] ?? chart.heroPosition}
          </p>

          <span className="flex h-3.5 w-full" aria-hidden="true">
            {mix.map((entry) => (
              <span
                key={`${entry.action}-${entry.size ?? ''}`}
                style={{ width: `${entry.freq * 100}%`, backgroundColor: actionStyle(entry.action).hex }}
              />
            ))}
          </span>

          <ul className="flex flex-col gap-1" data-testid="hero-mix">
            {mix.map((entry) => (
              <li
                key={`${entry.action}-${entry.size ?? ''}`}
                className="flex items-baseline gap-2 font-mono text-sm text-ink"
              >
                <span aria-hidden="true" className="w-3 text-ink-muted">
                  {actionStyle(entry.action).glyph}
                </span>
                <span>{actionLabel(entry.action, entry.size)}</span>
                <span className="leader" />
                <span>{percent(entry.freq)}</span>
              </li>
            ))}
          </ul>

          <p className="sr-only">{describeMix(selected, frequencies)}</p>

          <p className="text-sm text-ink-muted">
            {mix.length > 1
              ? 'Not one or the other. Both, in those proportions — and a trainer that marks either one wrong is teaching a different game.'
              : 'A pure hand: one action, every time. The split cells are the ones worth studying — try one.'}
          </p>
        </div>
      </div>

      <figcaption className="flex items-baseline gap-6">
        <span className="shrink-0 font-mono text-xs text-ink-muted">{figure}</span>
        <span className="max-w-[34rem] text-sm text-ink-muted">
          {label}: {width(combos)} of hands — {Math.round(combos).toLocaleString('en-GB')} of{' '}
          {ALL_COMBOS.toLocaleString('en-GB')} combinations. A split cell is played both ways; the
          figure in its corner is the share of the right-hand action. Click any of the 169.
        </span>
      </figcaption>
    </figure>
  );
}
