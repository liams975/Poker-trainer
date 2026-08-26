import type { HandState, Position } from '@poker/engine';
import { actionOrder } from '@poker/engine';

import { cn } from '@/lib/utils';

/**
 * The six seats, left to right in preflop action order.
 *
 * Not an oval felt table. docs/05-ui-ux.md's design thesis is "a lab, not a
 * casino", and a strip in action order makes the one thing that matters
 * preflop — who has already acted, and who is still behind you — readable at a
 * glance. A ring makes you count seats clockwise to work that out.
 *
 * Monochrome throughout: saturated colour belongs to strategy data, and this is
 * the state of the hand, not a recommendation about it.
 */
export function TableSeats({ state, hero }: { state: HandState; hero: Position }) {
  const order = actionOrder('preflop');

  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Seats, in order of action">
      {order.map((position) => {
        const seat = state.seats.find((s) => s.position === position);
        if (seat === undefined) return null;

        const isHero = position === hero;
        const folded = seat.status === 'folded';
        // What this seat put in across the hand — the blinds and any raise.
        const committed = seat.totalCommitted;

        return (
          <li
            key={position}
            className={cn(
              'flex min-w-[4.5rem] flex-col gap-0.5 rounded-[var(--radius)] border px-2 py-1.5',
              isHero
                ? 'border-ink bg-surface-raised'
                : 'border-line bg-surface',
              // Folded seats fade rather than disappear: the fact that four
              // players folded to you is the shape of the spot.
              folded && 'opacity-40',
            )}
          >
            <span className="flex items-baseline gap-1.5">
              <span className="font-display text-xs font-semibold text-ink">{position}</span>
              {isHero ? (
                <span className="text-[0.625rem] uppercase tracking-wider text-ink-muted">
                  you
                </span>
              ) : null}
            </span>

            <span className="font-mono text-[0.6875rem] text-ink-muted">
              {folded ? 'folded' : committed > 0 ? `${committed}bb` : '—'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
