import { RANK_MIN_SPOTS, RANK_TIERS, type PlayerRank } from '@poker/engine';

import { cn } from '@/lib/utils';

/**
 * The climb, drawn as an instrument scale — Limper to Nemesis along a ruler of
 * EV lost per spot, with a needle where the reader stands.
 *
 * A scale rather than a staircase, because rank here *is* a measurement: the
 * tiers are bands of one quantity, the boundaries are real numbers, and the
 * distance to the next band is the most useful thing on the page. A staircase
 * could only say "higher"; a ruler says "0.07 away".
 *
 * The axis runs worse → better, left to right, the way the tiers are listed.
 * Every tier is named in text and every tick is labelled, so neither the
 * needle's position nor the accent is load-bearing alone.
 */

/** The ends of the ruler, in bb lost per spot. Worse on the left. */
const SCALE = { from: 0.65, to: 0.1 } as const;
const TICKS = [0.6, 0.5, 0.4, 0.3, 0.2] as const;

/** Percent along the ruler for a figure, clamped to its ends. */
function x(value: number): number {
  const clamped = Math.min(Math.max(value, SCALE.to), SCALE.from);
  return ((SCALE.from - clamped) / (SCALE.from - SCALE.to)) * 100;
}

export function RankLadder({
  rank,
  n,
  heading = 'Your rank',
  caption,
  headingClassName = 'font-display text-4xl',
}: {
  rank: PlayerRank | undefined;
  /** A section number, set in mono before the heading like every other §. */
  n?: number | undefined;
  /** The landing page shows the same ladder as "The climb", with no reader. */
  heading?: string;
  /** Overrides the standing-specific sentence below the scale. */
  caption?: string;
  headingClassName?: string;
}) {
  // Each tier's band: from its own threshold (or the ruler's end) to the next.
  const bands = RANK_TIERS.map((tier, index) => ({
    name: tier.name,
    start: tier.threshold ?? SCALE.from,
    end: RANK_TIERS[index + 1]?.threshold ?? SCALE.to,
  }));

  return (
    <section aria-labelledby="rank-heading" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        {n === undefined ? null : <span className="font-mono text-sm text-ink-muted">§{n}</span>}
        <h2 id="rank-heading" className={headingClassName}>
          {heading}
        </h2>
        {rank ? (
          <p className="flex items-baseline gap-4">
            <span className="font-display text-5xl leading-none text-accent">{rankName(rank)}</span>
            <span className="font-mono text-sm text-ink-muted">
              {rank.evLossPerSpot.toFixed(2)} bb lost per spot
            </span>
          </p>
        ) : null}
      </div>

      <div className="relative mt-4 h-24" aria-hidden="true">
        {/* The bands, named. */}
        <ol className="absolute inset-x-0 top-0 h-9">
          {bands.map((band) => {
            const here = rank?.tier === band.name;
            return (
              <li
                key={band.name}
                className={cn(
                  'absolute top-0 flex h-9 items-center border-l border-ink-muted pl-2.5 text-sm',
                  here ? 'bg-accent/10 text-ink' : 'text-ink-muted',
                )}
                style={{ left: `${x(band.start)}%`, width: `${x(band.end) - x(band.start)}%` }}
              >
                <span className="truncate">{band.name}</span>
              </li>
            );
          })}
        </ol>

        {/* The ruler: a hairline, a tick every hundredth, a long one every
            twentieth, a figure every tenth. */}
        <div className="absolute inset-x-0 top-11 border-t border-ink" />
        {Array.from({ length: Math.round((SCALE.from - SCALE.to) * 100) + 1 }, (_, i) => {
          const value = SCALE.from - i / 100;
          const major = Math.round(value * 100) % 5 === 0;
          return (
            <span
              key={i}
              className={cn('absolute top-11 border-l', major ? 'h-2.5 border-ink' : 'h-1.5 border-ink-muted')}
              style={{ left: `${x(value)}%` }}
            />
          );
        })}
        {TICKS.map((value) => (
          <span
            key={value}
            className="absolute top-[3.75rem] -translate-x-1/2 font-mono text-xs text-ink-muted"
            style={{ left: `${x(value)}%` }}
          >
            {value.toFixed(1)}
          </span>
        ))}

        {rank ? (
          <>
            {/* The needle: the one mark on the scale that is yours, so it is
                the one in the accent. */}
            <span
              className="absolute -top-1.5 h-[3.75rem] border-l-2 border-accent"
              style={{ left: `${x(rank.evLossPerSpot)}%` }}
            />
            <span
              className="absolute -top-3 size-2.5 -translate-x-[4px] rotate-45 bg-accent"
              style={{ left: `${x(rank.evLossPerSpot)}%` }}
            />
            {rank.next ? (
              <span
                className="absolute top-[5.25rem] -translate-x-1/2 whitespace-nowrap font-mono text-xs text-ink"
                style={{ left: `${x(rank.next.evLossPerSpot)}%` }}
              >
                ↑ {rank.next.tier} at {rank.next.evLossPerSpot.toFixed(2)}
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      {/* The scale in words, for anyone the drawing does not reach. */}
      <p className="sr-only">
        Tiers from worst to best: {bands.map((band) => band.name).join(', ')}.
      </p>

      <p className="mt-4 max-w-xl text-sm text-ink-muted">{caption ?? describe(rank)}</p>
    </section>
  );
}

const NUMERALS = ['I', 'II', 'III'] as const;

/** e.g. "Grinder I". Divisions climb toward the next tier, so III is the top. */
export function rankName(rank: PlayerRank): string {
  const division = rank.division ? ` ${NUMERALS[rank.division - 1] ?? ''}` : '';
  return `${rank.tier}${division}`.trim();
}

function describe(rank: PlayerRank | undefined): string {
  if (!rank) {
    return `Ranked after ${RANK_MIN_SPOTS} graded answers. Ranks come from EV lost per spot, not from time served — so the count has to mean something before the tier does.`;
  }

  const standing = `${rankName(rank)} — ${rank.evLossPerSpot.toFixed(2)}bb lost per spot over your last ${RANK_MIN_SPOTS} answers.`;

  if (!rank.next) return `${standing} Nothing above this.`;

  return `${standing} ${rank.next.tier} at ${rank.next.evLossPerSpot.toFixed(2)}. You are ${rank.next.gap.toFixed(2)} away.`;
}
