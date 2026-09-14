import { RANK_MIN_SPOTS } from '@poker/engine';

import type { BoardRow } from '@/lib/progress/types';
import { cn } from '@/lib/utils';

/**
 * The weekly EV board — frame 2g.
 *
 * The only screen in this product that shows another person anything. What it
 * can show is fixed by `weekly_leaderboard()`: a chosen handle, an average and
 * a spot count, for players who opted in. There is no row shape here that could
 * carry a name, an email or an id, because the function does not return one.
 *
 * Rendered from whatever the server sent. An empty board is the normal state of
 * a fresh week and says so, rather than rendering an empty table.
 */
export function WeeklyBoard({
  rows,
  optedIn,
}: {
  rows: readonly BoardRow[];
  optedIn: boolean;
}) {
  return (
    <section aria-labelledby="board-heading" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="board-heading" className="font-display text-2xl">
          Weekly board
        </h2>
        <p className="font-mono text-xs text-ink-muted">resets Monday</p>
      </header>

      {rows.length === 0 ? (
        <p className="max-w-prose text-sm text-ink-muted">
          Nobody has played {RANK_MIN_SPOTS} graded spots this week yet.
          {optedIn ? ' You are entered.' : ' You are not entered.'}
        </p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">
            Players ranked by EV lost per spot this week, lowest first
          </caption>
          <thead>
            <tr className="border-b border-line text-left font-mono text-[0.625rem] uppercase tracking-wider text-ink-muted">
              <th scope="col" className="py-2 font-normal">
                #
              </th>
              <th scope="col" className="py-2 font-normal">
                Player
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                EV / spot
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Spots
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.position}-${row.handle}`}
                className={cn(
                  'border-b border-line last:border-b-0',
                  // A tint, plus the word "you" below — never the tint alone.
                  row.isYou && 'bg-accent/15',
                )}
              >
                <td className="py-2 font-mono text-xs text-ink-muted">{row.position}</td>
                <td className={cn('py-2', row.isYou && 'text-accent-hi')}>
                  {row.handle}
                  {row.isYou ? <span className="ml-2 text-xs text-ink-muted">you</span> : null}
                </td>
                <td className="py-2 text-right font-mono text-xs">
                  −{row.evLossPerSpot.toFixed(2)}
                </td>
                <td className="py-2 text-right font-mono text-xs text-ink-muted">
                  {row.spots.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="max-w-prose text-xs text-ink-muted">
        EV lost per spot, lower is better. {RANK_MIN_SPOTS}-spot minimum, so a four-hand hot
        streak cannot top it. Study sessions are excluded.
      </p>
    </section>
  );
}
