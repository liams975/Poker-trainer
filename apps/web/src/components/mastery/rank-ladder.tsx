import { RANK_MIN_SPOTS, RANK_TIERS, type PlayerRank } from '@poker/engine';

import { cn } from '@/lib/utils';

/**
 * The climb — Limper to Nemesis, with where the reader currently stands.
 *
 * Heights rise across the ladder and the fill warms from neutral to accent, so
 * the shape reads as a climb before any of the text is parsed. The tier name is
 * printed under every bar, so neither height nor colour is load-bearing alone.
 */
export function RankLadder({ rank }: { rank: PlayerRank | undefined }) {
  return (
    <section aria-labelledby="rank-heading" className="flex flex-col gap-4">
      <h2 id="rank-heading" className="font-display text-2xl">
        Your rank
      </h2>

      <ol className="flex items-end gap-2">
        {RANK_TIERS.map((tier, index) => {
          const here = rank?.tier === tier.name;

          return (
            <li key={tier.name} className="flex flex-1 flex-col items-center gap-2">
              <span
                className={cn(
                  'w-full rounded-t-[var(--radius)]',
                  here ? 'bg-accent' : 'bg-line',
                )}
                // Rises 10px -> 54px across the five tiers, as the deck draws it.
                style={{ height: `${10 + index * 11}px` }}
              />
              <span
                className={cn(
                  'text-center text-xs',
                  here ? 'font-medium text-accent-hi' : 'text-ink-muted',
                )}
              >
                {tier.name}
              </span>
              <span className="font-mono text-[0.625rem] text-ink-muted">
                {tier.threshold === undefined ? 'start' : `−${tier.threshold.toFixed(2)}`}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="text-sm text-ink-muted">{describe(rank)}</p>
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
