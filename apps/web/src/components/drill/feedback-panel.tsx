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
 * The mix as one bar, the same stacked bar a grid cell draws, at the size of a
 * statement: passive on the left, aggressive on the right, and a marker over
 * the part you chose.
 *
 * The segments grow to their frequency rather than appearing at it. docs/05
 * calls this "where retention is won or lost", and the difference between a
 * mix that *arrives* and one that is simply there is most of the felt quality
 * of the whole app.
 *
 * **`index` drives the stagger; the grade does not reach this component at
 * all.** That is deliberate and enforced by `tests/feedback-motion.test.ts`: a
 * flourish on `optimal` that did not also fire on `acceptable` would re-assert
 * the right/wrong framing the four tiers exist to reject.
 */
function MixBar({
  hand,
  mix,
  chosenKey,
}: {
  hand: HandNotation;
  mix: readonly ActionFreq[];
  chosenKey: string | null;
}) {
  return (
    <div className="relative flex h-11 w-full bg-canvas" aria-hidden="true">
      {mix.map((entry, index) => {
        const key = `${entry.action}-${entry.size ?? ''}`;
        return (
          <m.span
            // Keyed on the hand too: moving to the next spot must re-grow the
            // bar rather than sliding the previous hand's widths across.
            key={`${hand}-${key}`}
            className="relative block h-full"
            style={{ backgroundColor: actionStyle(entry.action).hex }}
            initial={{ width: 0 }}
            animate={{ width: `${entry.freq * 100}%` }}
            transition={{ duration: 0.45, delay: 0.05 + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
          >
            {chosenKey === key ? (
              // Marks what the user actually chose, without implying a verdict.
              <span className="label-caps absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-2xs text-ink">
                you ▾
              </span>
            ) : null}
          </m.span>
        );
      })}
    </div>
  );
}

/**
 * One row of the distribution: glyph, label, a dot leader, the exact frequency.
 * The hue lives in the bar above; the row is where the mix is named in words.
 */
function MixRow({
  entry,
  chosen,
}: {
  entry: ActionFreq;
  chosen: boolean;
}) {
  const style = actionStyle(entry.action);

  return (
    <li className="flex items-baseline gap-3 font-mono text-sm">
      <span aria-hidden="true" className="w-3 text-ink-muted">
        {style.glyph}
      </span>
      <span className={cn(chosen ? 'text-ink' : 'text-ink-muted')}>
        {actionLabel(entry.action, entry.size)}
      </span>
      {chosen ? <span className="label-caps text-2xs text-ink">you</span> : null}
      <span className="leader" aria-hidden="true" />
      <span className="font-display text-2xl leading-none text-ink">{percent(entry.freq)}</span>
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
  const mix = orderedMix(frequencies);

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

    const forAction = mix.filter((e) => e.action === answer.action);
    if (forAction.length === 0) return null;

    const exact = forAction.find((e) => e.size === answer.size);
    const marked = exact ?? forAction.reduce((best, e) => (e.freq > best.freq ? e : best));
    return `${marked.action}-${marked.size ?? ''}`;
  })();

  return (
    // The solution, set beside the problem: docs/05's first desktop advantage
    // is that the spot stays on screen while this appears.
    <div className="flex flex-col gap-9 border border-line bg-surface p-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <span className="label-caps text-ink">{grade ? 'Solution' : 'The chart'}</span>
        {grade ? (
          <span className="font-mono text-xs text-ink-muted">EV lost {grade.evLoss}bb</span>
        ) : null}
      </div>

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
         * mid-fade. docs/05 requires the grade to land "immediately, under
         * 100ms, no spinner", and fading in the one piece of text the user is
         * waiting for is the opposite of that. Transform only, so the words are
         * at full contrast on the first frame.
         */
        <m.section
          className="-mt-3 flex flex-col gap-3"
          aria-live="polite"
          data-testid="grade"
          initial={{ y: -6 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <div className="flex items-baseline gap-4">
            <span
              aria-hidden="true"
              className="text-3xl leading-none"
              style={{ color: tier.hex }}
            >
              {tier.glyph}
            </span>
            {/*
              The glyph beside this carries the tier's hue; the words do not.
              Phase 14 found three of the four tier hues under 4.5:1 as text,
              and the hues are Okabe–Ito and must not be retuned to win a ratio
              (CLAUDE.md) — so the heading is ink, and the glyph plus the label
              encode the tier twice over.

              Set in the display face at the size of a statement: this is the
              line the whole spot was for. The same size for all four tiers,
              for the reason the motion is the same — two of them are correct
              answers to a mixed spot.
            */}
            <h2 className="font-display text-5xl text-ink" data-tier={grade.tier}>
              {tier.label}
            </h2>
          </div>

          <p className="max-w-[34rem] text-lg text-ink">{tierMessage(grade, answer)}</p>
          {sizeNote ? <p className="font-mono text-sm text-ink-muted">{sizeNote}</p> : null}
        </m.section>
      ) : null}

      <section className="flex flex-col gap-4 pt-3" aria-labelledby="mix-heading">
        <h3 id="mix-heading" className="sr-only">
          What {hand} plays
        </h3>
        <MixBar hand={hand} mix={mix} chosenKey={chosenKey} />
        <ul
          className="flex flex-col gap-1.5"
          data-testid="distribution"
          data-mix={describeMix(hand, frequencies)}
        >
          {mix.map((entry) => (
            <MixRow
              key={`${hand}-${entry.action}-${entry.size ?? ''}`}
              entry={entry}
              chosen={chosenKey === `${entry.action}-${entry.size ?? ''}`}
            />
          ))}
        </ul>
      </section>

      {rationale ? (
        <section className="flex flex-col gap-3" aria-labelledby="why-heading">
          <h3 id="why-heading" className="label-caps text-ink-muted">
            Why
          </h3>
          <RationaleChips rationale={rationale} verbose={verbose} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
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
