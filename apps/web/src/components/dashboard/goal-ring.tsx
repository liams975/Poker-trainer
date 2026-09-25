'use client';

import { m } from 'motion/react';

/**
 * The daily goal, as a tally.
 *
 * Phase 9 drew a ring; Phase 17 draws one mark per spot, the way you would
 * keep count on paper. A ring says "about two thirds"; twenty marks with
 * fourteen filled says fourteen, and says how many are left without the reader
 * subtracting. The name and the test id stay `goal-ring`, because what the
 * rest of the app depends on — the label, `data-met` — did not change.
 *
 * The accent is allowed here: the daily goal is the game layer. Colour is not
 * the only encoding — the count is written beside the marks, the label carries
 * it for a screen reader, and a met goal adds a tick.
 */
export function GoalRing({ done, target }: { done: number; target: number }) {
  const met = done >= target && target > 0;
  // One mark per spot of the target. Past the target the marks stay full and
  // the tick says the rest; drawing 104 marks would say nothing more.
  const marks = Math.max(target, 0);

  return (
    <span
      className="inline-flex items-end gap-1.5"
      role="img"
      aria-label={
        met
          ? `Daily goal met: ${done} of ${target} spots`
          : `Daily goal: ${done} of ${target} spots`
      }
      data-testid="goal-ring"
      data-met={met}
    >
      <span className="flex h-6 items-end gap-[3px]" aria-hidden="true">
        {Array.from({ length: marks }, (_, index) => {
          const filled = index < done;
          return (
            <span key={index} className="relative h-6 w-1 bg-line-soft">
              {filled ? (
                // Each mark fills upward in turn on mount — the one moment of
                // motion on the desk, and it is progress, which is the kind of
                // thing docs/05 lets move. Covered by MotionConfig's
                // reducedMotion="user", not by the CSS block.
                <m.span
                  className="absolute inset-x-0 bottom-0 block bg-accent"
                  initial={{ height: '0%' }}
                  animate={{ height: '100%' }}
                  transition={{
                    duration: 0.25,
                    delay: 0.1 + index * 0.025,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                />
              ) : null}
            </span>
          );
        })}
      </span>
      {met ? (
        <span className="text-base leading-none text-accent" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </span>
  );
}
