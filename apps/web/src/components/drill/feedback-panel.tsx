'use client';

import type { ActionFreq, Answer, Grade, HandNotation, Rationale, RangeChart } from '@poker/engine';
import { handStrategy } from '@poker/engine';
import { useState } from 'react';

import { actionLabel, actionStyle } from '@/components/range/action-colors';
import { describeMix, orderedMix, percent } from '@/components/range/mix-format';
import { RangeGrid } from '@/components/range/range-grid';
import { RationaleChips } from '@/components/range/rationale-chips';
import { cn } from '@/lib/utils';

import { sizeMessage, tierMessage, tierStyle } from './grade-tiers';

/**
 * The feedback moment. docs/05-ui-ux.md: "This is where retention is won or
 * lost."
 *
 * The non-negotiable is that **the full distribution always appears** — never a
 * bare right/wrong. docs/03-poker-engine.md is blunt about why: teaching
 * someone that `AJo` "is a fold" when it opens 40% of the time actively makes
 * them a worse player. The mix is the lesson; the grade is a footnote on it.
 *
 * `grade.primary` is shown as what the hand *mostly* does, never as "the right
 * answer". On a 50/50 hand the tier is optimal while `primary` names the other
 * action, and grade.ts is explicit that the tier is the judgement.
 */
export interface FeedbackPanelProps {
  hand: HandNotation;
  chart: RangeChart;
  chartLabel: string;
  frequencies: readonly ActionFreq[];
  rationale: Rationale | null;
  /** Absent while the chart is on show in Study Mode but nothing is answered. */
  grade?: Grade | undefined;
  answer?: Answer | undefined;
  /** Study Mode renders every factor; Drill Mode renders the decisive ones. */
  verbose: boolean;
}

/** One row of the distribution: label, proportional bar, exact frequency. */
function MixRow({
  entry,
  chosen,
}: {
  entry: ActionFreq;
  chosen: boolean;
}) {
  const style = actionStyle(entry.action);

  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="flex w-32 shrink-0 items-center gap-2">
        <span aria-hidden="true" style={{ color: style.hex }}>
          {style.glyph}
        </span>
        <span className={cn(chosen && 'font-semibold text-ink')}>
          {actionLabel(entry.action, entry.size)}
        </span>
      </span>

      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-raised">
        <span
          className="block h-full"
          style={{ width: `${entry.freq * 100}%`, backgroundColor: style.hex }}
        />
      </span>

      <span className="w-14 shrink-0 text-right font-mono text-xs text-ink-muted">
        {percent(entry.freq)}
      </span>

      {/* Marks what the user actually chose, without implying a verdict. */}
      <span className="w-16 shrink-0 text-right text-[0.6875rem] uppercase tracking-wider text-ink-muted">
        {chosen ? 'you' : ''}
      </span>
    </li>
  );
}

export function FeedbackPanel({
  hand,
  chart,
  chartLabel,
  frequencies,
  rationale,
  grade,
  answer,
  verbose,
}: FeedbackPanelProps) {
  // The grid stays explorable — seeing a hand's neighbours is most of why it is
  // here — so selection is local and starts on hero's hand.
  const [inspected, setInspected] = useState<HandNotation>(hand);

  const tier = grade ? tierStyle(grade.tier) : null;
  const sizeNote = grade ? sizeMessage(grade) : null;

  /**
   * Which row to mark as the user's.
   *
   * Matching on action *and* size alone leaves the answer unmarked whenever the
   * chosen size is not one the chart uses — raise to 3bb against a chart that
   * raises to 2.5bb marked nothing at all, so the panel showed a grade for an
   * answer it never displayed. The action is what the row is about; the size
   * difference is what `sizeMessage` is for.
   */
  const chosenKey = (() => {
    if (answer === undefined) return null;

    const forAction = orderedMix(frequencies).filter((e) => e.action === answer.action);
    if (forAction.length === 0) return null;

    const exact = forAction.find((e) => e.size === answer.size);
    const marked = exact ?? forAction.reduce((best, e) => (e.freq > best.freq ? e : best));
    return `${marked.action}-${marked.size ?? ''}`;
  })();

  return (
    <div className="flex flex-col gap-5 rounded-[var(--radius)] border border-line bg-surface p-5">
      {grade && answer && tier ? (
        <section className="flex flex-col gap-2" aria-live="polite" data-testid="grade">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="text-lg leading-none"
              style={{ color: tier.hex }}
            >
              {tier.glyph}
            </span>
            <h2
              className="font-display text-base font-semibold"
              style={{ color: tier.hex }}
              data-tier={grade.tier}
            >
              {tier.label}
            </h2>
          </div>

          <p className="text-sm text-ink">{tierMessage(grade, answer)}</p>
          {sizeNote ? <p className="text-sm text-ink-muted">{sizeNote}</p> : null}
          <p className="font-mono text-xs text-ink-muted">
            EV loss {grade.evLoss}bb
          </p>
        </section>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="mix-heading">
        <h3 id="mix-heading" className="text-xs uppercase tracking-wider text-ink-muted">
          <span className="font-mono text-ink">{hand}</span> plays
        </h3>

        <ul className="flex flex-col gap-1.5" data-testid="distribution" data-mix={describeMix(hand, frequencies)}>
          {orderedMix(frequencies).map((entry) => (
            <MixRow
              key={`${entry.action}-${entry.size ?? ''}`}
              entry={entry}
              chosen={chosenKey === `${entry.action}-${entry.size ?? ''}`}
            />
          ))}
        </ul>
      </section>

      {rationale ? (
        <section className="flex flex-col gap-2" aria-labelledby="why-heading">
          <h3 id="why-heading" className="text-xs uppercase tracking-wider text-ink-muted">
            Why
          </h3>
          <RationaleChips rationale={rationale} verbose={verbose} />
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <RangeGrid
          chart={chart}
          label={`${chartLabel} — ${hand} in context`}
          selected={inspected}
          onSelect={setInspected}
        />
        {/* Selecting a neighbour reads out its mix, so the grid is a study tool
            rather than decoration. Hero's own hand stays the graded one above,
            and each readout names its hand so the two cannot be confused. */}
        {inspected !== hand ? (
          <p className="font-mono text-xs text-ink-muted" data-testid="inspected-mix">
            {describeMix(inspected, handStrategy(chart.ranges, inspected))}
          </p>
        ) : null}
      </section>
    </div>
  );
}
