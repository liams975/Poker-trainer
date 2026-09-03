'use client';

import type { HandNotation, RangeChart } from '@poker/engine';
import { handStrategy } from '@poker/engine';
import { useState } from 'react';

import { actionLabel } from '@/components/range/action-colors';
import { describeMix, orderedMix, percent } from '@/components/range/mix-format';
import { RangeGrid } from '@/components/range/range-grid';

/**
 * The one thing on the landing page that is not a claim.
 *
 * A screenshot would be smaller and it would also be a picture of software
 * rather than the software. This is the real grid component, driven by a real
 * seeded chart, and it is interactive — clicking a hand shows its actual mix.
 * The argument the page makes is "ranges are frequencies, not lists", and the
 * most convincing way to make it is to let someone click `AJo` and see 60/40.
 */
export function HeroGrid({ chart, label }: { chart: RangeChart; label: string }) {
  // Opens on a genuinely mixed hand, because the whole point being made above
  // is that a hand can be two things at once. A pure hand would illustrate the
  // opposite of the sentence it sits under.
  const [selected, setSelected] = useState<HandNotation>('AJo');

  const frequencies = handStrategy(chart.ranges, selected);
  const mix = orderedMix(frequencies);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <RangeGrid chart={chart} selected={selected} onSelect={setSelected} label={label} />

      <div className="flex flex-col gap-3">
        <h3 className="font-display text-sm font-semibold">
          {label} · {selected}
        </h3>

        <p className="text-sm text-ink-muted">{describeMix(selected, frequencies)}</p>

        <ul className="flex flex-col gap-1.5">
          {mix.map((entry) => (
            <li
              key={`${entry.action}-${entry.size ?? ''}`}
              className="flex items-center gap-3 text-sm"
            >
              <span className="w-28 shrink-0">{actionLabel(entry.action, entry.size)}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-raised">
                <span
                  className="block h-full bg-ink-muted"
                  style={{ width: `${entry.freq * 100}%` }}
                />
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-xs text-ink-muted">
                {percent(entry.freq)}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-xs text-ink-muted">
          A real chart from the app, not a screenshot. Click any of the 169 hands.
        </p>
      </div>
    </div>
  );
}
