'use client';

import type { Action, ChartRegistry, LessonBlock, RangeChart } from '@poker/engine';
import {
  ACTIONS,
  CANONICAL_HANDS,
  comboCount,
  comboCountOf,
  handStrategy,
  toWeights,
} from '@poker/engine';

import { ActionLegend } from '@/components/range/action-legend';
import { actionStyle } from '@/components/range/action-colors';
import { ChartSpotTable } from '@/components/range/chart-spot-table';
import { orderedMix, percent } from '@/components/range/mix-format';
import { RangeGrid } from '@/components/range/range-grid';
import { chartLabel } from '@/lib/charts/map';
import { cn } from '@/lib/utils';

import { EmbeddedDrill, type EmbeddedDrillProps } from './embedded-drill';

/**
 * Rendering a lesson — set as a page of a textbook.
 *
 * The block union is validated in the engine, so anything that reaches here has
 * already been checked against the charts and templates it references — a
 * `range` block naming a chart nobody authored fails at sync time rather than
 * rendering an empty box a reader mistakes for the point.
 *
 * Phase 17 gave the page a margin, after Tufte: a range figure's key and its
 * measured width sit beside the grid, and callouts become sidenotes. Nothing in
 * the margin is authored — every figure there is derived from the chart the
 * block names, so the note cannot drift from the grid it annotates.
 *
 * The margin works by float: the lesson column carries right padding, and a
 * margin item floats into it with a matching negative margin. That is why the
 * column is block layout rather than flex — a flex item cannot float.
 *
 * Callouts are monochrome. docs/05-ui-ux.md reserves saturated colour for
 * strategy data, and a lesson page puts a 13x13 grid a few hundred pixels below
 * a warning box — colouring the warning would put a sixth meaning-bearing hue
 * next to five that mean actions.
 */

export interface BlockProps {
  block: LessonBlock;
  chartFor: (heroPosition: string, actionSequence: string) => RangeChart | undefined;
  /** Needed to draw a `range` block's spot: an opener's raise is priced from
   *  their own RFI chart, which means the whole set, not just this one. */
  registry: ChartRegistry;
  /**
   * The chart the lesson most recently displayed, so a `hands` block can show
   * what those hands actually do rather than only naming them.
   */
  nearestChart: RangeChart | undefined;
  drill: Omit<EmbeddedDrillProps, 'templateSlug' | 'spots'>;
  /** "Fig. 2.2a" — set on range blocks, numbered by the lesson. */
  figure?: string | undefined;
  /** "Exercise 2.2" — set on drill blocks. */
  exercise?: string | undefined;
  /** The lesson's first paragraph, which opens with a drop cap. */
  lead?: boolean | undefined;
}

/** Floats a note into the lesson's right margin at xl; inline below that. */
const MARGIN =
  'mb-6 flex flex-col gap-3 xl:float-right xl:clear-right xl:-mr-[19rem] xl:mb-0 xl:w-[16rem]';

/** Every two-card holding, counted from the engine's own hand list. */
const ALL_COMBOS = CANONICAL_HANDS.reduce((total, hand) => total + comboCountOf(hand), 0);

function Prose({ text, lead = false }: { text: string; lead?: boolean }) {
  return (
    <p
      className={cn(
        'max-w-[40rem] text-lg text-ink',
        // A drop cap on the lesson's first paragraph, in the display face — the
        // oldest way a page says "begin here".
        lead &&
          'first-letter:float-left first-letter:mt-2 first-letter:mr-3 first-letter:font-display first-letter:text-[5.25rem] first-letter:leading-[0.72]',
      )}
    >
      {text}
    </p>
  );
}

function KeyPoints({ points }: { points: readonly string[] }) {
  return (
    <section aria-label="Summary" className="max-w-[40rem] border border-line px-8 py-7">
      <p className="label-caps text-ink">Summary</p>
      <ol className="mt-5 flex list-none flex-col gap-4">
        {points.map((point, index) => (
          <li key={point} className="grid grid-cols-[2.5rem_1fr] items-baseline">
            <span aria-hidden="true" className="font-display text-2xl italic text-ink-muted">
              {index + 1}
            </span>
            <span className="text-lg text-ink">{point}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Callout({ tone, text }: { tone: 'note' | 'warning'; text: string }) {
  const label = tone === 'warning' ? 'Watch out' : 'Note';

  return (
    <aside
      className={cn(MARGIN, 'border-t border-ink pt-3 xl:border-t-0 xl:pt-1')}
      aria-label={label}
    >
      {/* The glyph and the label both carry the tone, so it survives greyscale
          and a screen reader alike — there is no colour doing this work. */}
      <span className="label-caps flex items-center gap-2 text-ink">
        <span aria-hidden="true">{tone === 'warning' ? '!' : '†'}</span>
        {label}
      </span>
      <p className="text-sm text-ink-muted">{text}</p>
    </aside>
  );
}

/** What the margin says about a chart: its width and how much of it mixes. */
function chartFacts(chart: RangeChart) {
  const combos = comboCount(toWeights(chart.ranges));
  const mixed = CANONICAL_HANDS.filter(
    (hand) => handStrategy(chart.ranges, hand).filter((entry) => entry.freq > 0).length > 1,
  ).length;
  const actions = new Set<Action>();
  for (const hand of CANONICAL_HANDS) {
    for (const entry of handStrategy(chart.ranges, hand)) {
      if (entry.freq > 0) actions.add(entry.action);
    }
  }
  return {
    width: `${((combos / ALL_COMBOS) * 100).toFixed(1)}%`,
    combos: Math.round(combos),
    mixed,
    actions: ACTIONS.filter((action) => actions.has(action)),
  };
}

function RangeBlock({
  chart,
  caption,
  registry,
  figure,
}: {
  chart: RangeChart | undefined;
  caption?: string | undefined;
  registry: ChartRegistry;
  figure?: string | undefined;
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

  const facts = chartFacts(chart);

  return (
    <figure className="mx-0 mt-0 flow-root">
      {/* The spot, before the grid of what to do in it.
          A lesson reader meets "BB vs BTN open" as a phrase they are still
          learning to parse; the ring says it without their having to. Same
          component and same `chartSpot` construction as the Range Explorer. */}
      <div className="max-w-[40rem]">
        <ChartSpotTable chart={chart} registry={registry} />
      </div>

      <div className="mt-7">
        <aside className={cn(MARGIN, 'xl:mt-7')} aria-label={`${chartLabel(chart)}, in figures`}>
          <span className="label-caps text-ink">Key</span>
          <ActionLegend actions={facts.actions} />
          <p className="font-mono text-sm text-ink">
            {facts.width} of hands played
            <br />
            <span className="text-ink-muted">
              {facts.combos.toLocaleString('en-GB')} of {ALL_COMBOS.toLocaleString('en-GB')}{' '}
              combinations
            </span>
          </p>
          <p className="text-sm text-ink-muted">
            {facts.mixed === 0
              ? 'Every hand here is pure: one action, every time.'
              : `${facts.mixed} ${facts.mixed === 1 ? 'hand mixes' : 'hands mix'}. A split cell is played both ways — passive left, aggressive right — and the corner figure is the right-hand share.`}
          </p>
        </aside>

        {/* `chartLabel`, not the raw key: "BTN open" rather than "BTN rfi". The
            action sequence is a lookup key, not something to show a reader. */}
        <div className="max-w-[40rem]">
          <RangeGrid
            chart={chart}
            label={chartLabel(chart)}
            selected={null}
            onSelect={() => undefined}
          />
        </div>
      </div>

      {caption || figure ? (
        <figcaption className="mt-4 flex max-w-[40rem] items-baseline gap-5">
          {figure ? (
            <span className="shrink-0 font-mono text-xs text-ink-muted">{figure}</span>
          ) : null}
          {caption ? <span className="text-base italic text-ink-muted">{caption}</span> : null}
        </figcaption>
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
    <figure className="mx-0 mt-0 flex max-w-[40rem] flex-col gap-4">
      <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
        {hands.map((hand) => {
          const mix = chart ? orderedMix(handStrategy(chart.ranges, hand as never)) : [];

          return (
            <li key={hand} className="flex flex-col gap-3 bg-canvas p-4">
              <span className="font-mono text-xl text-ink">{hand}</span>
              {mix.length > 0 ? (
                <>
                  <span aria-hidden="true" className="flex h-2 w-full">
                    {mix.map((entry) => (
                      <span
                        key={`${entry.action}-${entry.size ?? ''}`}
                        style={{
                          width: `${entry.freq * 100}%`,
                          backgroundColor: actionStyle(entry.action).hex,
                        }}
                      />
                    ))}
                  </span>
                  <span className="flex flex-col gap-0.5 font-mono text-xs text-ink-muted">
                    {mix.map((entry) => (
                      <span key={`${entry.action}-${entry.size ?? ''}`}>
                        <span aria-hidden="true">{actionStyle(entry.action).glyph}</span>{' '}
                        {actionStyle(entry.action).label} {percent(entry.freq)}
                      </span>
                    ))}
                  </span>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      {caption ? (
        <figcaption className="text-base italic text-ink-muted">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

export function LessonBlockView({
  block,
  chartFor,
  nearestChart,
  drill,
  registry,
  figure,
  exercise,
  lead,
}: BlockProps) {
  switch (block.kind) {
    case 'prose':
      return <Prose text={block.text} lead={lead ?? false} />;

    case 'key_points':
      return <KeyPoints points={block.points} />;

    case 'callout':
      return <Callout tone={block.tone} text={block.text} />;

    case 'range':
      return (
        <RangeBlock
          chart={chartFor(block.heroPosition, block.actionSequence)}
          caption={block.caption}
          registry={registry}
          figure={figure}
        />
      );

    case 'hands':
      return <Hands hands={block.hands} caption={block.caption} chart={nearestChart} />;

    case 'drill':
      return (
        <EmbeddedDrill
          {...drill}
          templateSlug={block.templateSlug}
          spots={block.spots}
          {...(exercise === undefined ? {} : { exercise })}
        />
      );
  }
}
