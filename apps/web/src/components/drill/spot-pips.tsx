import { cn } from '@/lib/utils';

/**
 * Spot pips — frame 2c.
 *
 * One mark per spot in the session, filled as they are answered. It answers
 * "how much longer" at a glance, which a bare "27 / 50" makes you read and
 * subtract.
 *
 * **Flat, and it does not encode grades.** The deck is explicit that a bar is
 * data and gets no gradient or glow; and colouring a pip by tier would put a
 * verdict on every answer in the session at once, which is the framing the four
 * tiers exist to reject. Two of them are correct answers to a mixed spot.
 *
 * `aria-hidden`, because the count beside it is the accessible version and
 * fifty announced list items would be noise.
 */
export function SpotPips({ done, total }: { done: number; total: number }) {
  // An unbounded session (no planned length) has nothing to draw progress
  // against, and a bar that never fills is worse than no bar.
  if (total <= 0) return null;

  return (
    <span aria-hidden className="flex items-center gap-[3px]" data-testid="spot-pips">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            // Wider pips for short sessions, narrower for long ones, so a
            // fifty-spot run still fits the header.
            total > 30 ? 'h-1.5 w-1.5' : 'h-1.5 w-3',
            index < done ? 'bg-accent' : 'bg-line-soft',
            // The spot on the table now: outlined, not yet filled.
            index === done && 'outline outline-1 outline-accent',
          )}
        />
      ))}
    </span>
  );
}
