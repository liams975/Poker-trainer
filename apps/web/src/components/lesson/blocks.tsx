'use client';

import type { LessonBlock, RangeChart } from '@poker/engine';
import { handStrategy } from '@poker/engine';

import { actionStyle } from '@/components/range/action-colors';
import { orderedMix, percent } from '@/components/range/mix-format';
import { RangeGrid } from '@/components/range/range-grid';
import { chartLabel } from '@/lib/charts/map';

import { EmbeddedDrill, type EmbeddedDrillProps } from './embedded-drill';

/**
 * Rendering a lesson.
 *
 * The block union is validated in the engine, so anything that reaches here has
 * already been checked against the charts and templates it references — a
 * `range` block naming a chart nobody authored fails at sync time rather than
 * rendering an empty box a reader mistakes for the point.
 *
 * Callouts are monochrome. docs/05-ui-ux.md reserves saturated colour for
 * strategy data, and a lesson page puts a 13x13 grid a few hundred pixels below
 * a warning box — colouring the warning would put a sixth meaning-bearing hue
 * next to five that mean actions.
 */

export interface BlockProps {
  block: LessonBlock;
  chartFor: (heroPosition: string, actionSequence: string) => RangeChart | undefined;
  /**
   * The chart the lesson most recently displayed, so a `hands` block can show
   * what those hands actually do rather than only naming them.
   */
  nearestChart: RangeChart | undefined;
  drill: Omit<EmbeddedDrillProps, 'templateSlug' | 'spots'>;
}

function Prose({ text }: { text: string }) {
  return <p className="max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink">{text}</p>;
}

function KeyPoints({ points }: { points: readonly string[] }) {
  return (
    <ul className="flex max-w-[62ch] list-none flex-col gap-2 border-l-2 border-line pl-4">
      {points.map((point) => (
        <li key={point} className="text-[0.9375rem] leading-relaxed text-ink">
          {point}
        </li>
      ))}
    </ul>
  );
}

function Callout({ tone, text }: { tone: 'note' | 'warning'; text: string }) {
  const label = tone === 'warning' ? 'Watch out' : 'Note';

  return (
    <aside
      className="flex max-w-[62ch] gap-3 rounded-[var(--radius)] border border-line bg-surface-raised px-4 py-3"
      aria-label={label}
    >
      {/* The glyph and the label both carry the tone, so it survives greyscale
          and a screen reader alike — there is no colour doing this work. */}
      <span aria-hidden="true" className="text-ink-muted">
        {tone === 'warning' ? '!' : 'i'}
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-ink-muted">{label}</span>
        <p className="text-[0.9375rem] leading-relaxed text-ink">{text}</p>
      </div>
    </aside>
  );
}

function RangeBlock({
  chart,
  caption,
}: {
  chart: RangeChart | undefined;
  caption?: string | undefined;
}) {
  if (chart === undefined) {
    // Unreachable through the validator, which rejects a block naming a chart
    // that does not exist. Rendered rather than thrown so one bad row cannot
    // take a whole lesson down.
    return (
      <p className="text-sm text-ink-muted">
        This chart is not available in the published chart set.
      </p>
    );
  }

  return (
    <figure className="flex max-w-[46rem] flex-col gap-2">
      {/* `chartLabel`, not the raw key: "BTN open" rather than "BTN rfi". The
          action sequence is a lookup key, not something to show a reader. */}
      <RangeGrid
        chart={chart}
        label={chartLabel(chart)}
        selected={null}
        onSelect={() => undefined}
      />
      {caption ? (
        <figcaption className="text-sm text-ink-muted">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

/**
 * Named hands, with what they actually do.
 *
 * The mix is read from a chart the same lesson displays, so "look, these are
 * the close ones" is shown rather than asserted — and a hand that stopped being
 * mixed after a chart edit shows its new pure line instead of quietly
 * contradicting the prose beside it.
 */
function Hands({
  hands,
  caption,
  chart,
}: {
  hands: readonly string[];
  caption?: string | undefined;
  chart: RangeChart | undefined;
}) {
  return (
    <figure className="flex max-w-[62ch] flex-col gap-2">
      <ul className="flex flex-wrap gap-2">
        {hands.map((hand) => {
          const mix = chart ? orderedMix(handStrategy(chart.ranges, hand as never)) : [];

          return (
            <li
              key={hand}
              className="flex flex-col gap-1 rounded-[var(--radius)] border border-line bg-surface-raised px-3 py-2"
            >
              <span className="font-mono text-sm text-ink">{hand}</span>
              {mix.length > 0 ? (
                <span className="flex gap-2 font-mono text-[0.6875rem] text-ink-muted">
                  {mix.map((entry) => (
                    <span key={`${entry.action}-${entry.size ?? ''}`}>
                      <span aria-hidden="true" style={{ color: actionStyle(entry.action).hex }}>
                        {actionStyle(entry.action).glyph}
                      </span>{' '}
                      {percent(entry.freq)}
                    </span>
                  ))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {caption ? <figcaption className="text-sm text-ink-muted">{caption}</figcaption> : null}
    </figure>
  );
}

export function LessonBlockView({ block, chartFor, nearestChart, drill }: BlockProps) {
  switch (block.kind) {
    case 'prose':
      return <Prose text={block.text} />;

    case 'key_points':
      return <KeyPoints points={block.points} />;

    case 'callout':
      return <Callout tone={block.tone} text={block.text} />;

    case 'range':
      return (
        <RangeBlock
          chart={chartFor(block.heroPosition, block.actionSequence)}
          caption={block.caption}
        />
      );

    case 'hands':
      return <Hands hands={block.hands} caption={block.caption} chart={nearestChart} />;

    case 'drill':
      return <EmbeddedDrill {...drill} templateSlug={block.templateSlug} spots={block.spots} />;
  }
}
