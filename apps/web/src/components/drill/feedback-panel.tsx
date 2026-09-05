'use client';

import type { ActionFreq, Answer, Grade, HandNotation, Rationale, RangeChart } from '@poker/engine';
import { handStrategy } from '@poker/engine';
import { m } from 'motion/react';
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

/**
 * One row of the distribution: label, proportional bar, exact frequency.
 *
 * The bar grows to its frequency rather than appearing at it. docs/05 calls
 * this "where retention is won or lost", and the difference between a mix that
 * *arrives* and one that is simply there is most of the felt quality of the
 * whole app.
 *
 * **`index` drives the stagger; the grade does not reach this component at
 * all.** That is deliberate and enforced by `tests/feedback-motion.test.ts`: a
 * flourish on `optimal` that did not also fire on `acceptable` would re-assert
 * the right/wrong framing the four tiers exist to reject. Two of the four are
 * defensible answers to a mixed spot, so there is nothing here to celebrate
 * and nothing to commiserate.
 */
function MixRow({
  entry,
  chosen,
  index,
}: {
  entry: ActionFreq;
  chosen: boolean;
  index: number;
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
        <m.span
          className="block h-full"
          style={{ backgroundColor: style.hex }}
          initial={{ width: 0 }}
          animate={{ width: `${entry.freq * 100}%` }}
          transition={{ duration: 0.4, delay: 0.05 + index * 0.05, ease: [0.22, 1, 0.36, 1] }}
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
        /**
         * One entrance, identical for all four tiers.
         *
         * `initial`/`animate`/`transition` here are constants — nothing about
         * `grade.tier` reaches them. The tier decides the hue and the words, as
         * it always has; it must never decide the motion.
         *
         * **It slides; it does not fade.** The first version animated opacity
         * too, and `e2e/a11y.spec.ts` immediately failed it for contrast:
         * axe scans the moment the element appears and read the tier heading
         * mid-fade. That is not a scanner artefact to wait out — docs/05
         * requires the grade to land "immediately, under 100ms, no spinner",
         * and fading in the one piece of text the user is waiting for is the
         * opposite of that. Transform only, so the words are at full contrast
         * on the first frame.
         */
        <m.section
          className="flex flex-col gap-2"
          aria-live="polite"
          data-testid="grade"
          initial={{ y: -6 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
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
        </m.section>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="mix-heading">
        <h3 id="mix-heading" className="text-xs uppercase tracking-wider text-ink-muted">
          <span className="font-mono text-ink">{hand}</span> plays
        </h3>

        <ul className="flex flex-col gap-1.5" data-testid="distribution" data-mix={describeMix(hand, frequencies)}>
          {orderedMix(frequencies).map((entry, index) => (
            <MixRow
              // Keyed on the hand too: moving to the next spot must re-grow the
              // bars rather than sliding the previous hand's widths across.
              key={`${hand}-${entry.action}-${entry.size ?? ''}`}
              entry={entry}
              index={index}
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
