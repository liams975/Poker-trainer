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
    <span aria-hidden className="flex items-center gap-[2px]" data-testid="spot-pips">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-1 w-1.5 rounded-[1px]',
            index < done ? 'bg-accent' : 'bg-line',
          )}
        />
      ))}
    </span>
  );
}
