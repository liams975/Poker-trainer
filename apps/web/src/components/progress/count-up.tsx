'use client';

import { animate, useMotionValue, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

/**
 * A whole number, counting up to itself.
 *
 * Used for XP banked at the end of a session. Small, and the most direct answer
 * to "the app does not move": a number that arrives is a number you notice.
 *
 * Two things it gets right that a naive tween does not:
 *
 * 1. **It lands on the integer, explicitly.** The final frame of a tween is not
 *    guaranteed to be the target, and this figure is read off `xp_events`. A
 *    summary that says `+119` where the ledger holds 120 is a bug in the one
 *    place docs/05 insists every number came back from the server that wrote
 *    it. `onComplete` sets the exact value rather than trusting the last frame.
 *
 * 2. **It respects reduced motion itself.** `MotionConfig reducedMotion="user"`
 *    covers `m.*` components; `animate()` called imperatively is not a
 *    component and is not covered, so this asks directly. Without it the number
 *    would still spin for somebody who asked the whole system to hold still.
 */
export function CountUp({
  to,
  duration = 0.9,
  className,
  prefix = '',
  suffix = '',
}: {
  to: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}) {
  const value = useMotionValue(0);
  const [counted, setCounted] = useState(0);
  const reduced = useReducedMotion();

  /**
   * Derived, not assigned in the effect.
   *
   * The reduced-motion branch used to `setShown(to)` in the effect body, which
   * `react-hooks/set-state-in-effect` correctly rejects: it is a render that
   * schedules another render to reach a value the first one already knew. The
   * effect now only ever writes state from an animation callback, which is the
   * subscribe-to-an-external-system case effects are for.
   */
  const shown = reduced ? to : counted;

  useEffect(() => {
    if (reduced) return;

    value.set(0);

    const controls = animate(value, to, {
      duration,
      ease: 'easeOut',
      onUpdate: (latest) => setCounted(Math.round(latest)),
      onComplete: () => setCounted(to),
    });

    return () => controls.stop();
  }, [to, duration, reduced, value]);

  return (
    <span className={className}>
      {prefix}
      {shown.toLocaleString('en-GB')}
      {suffix}
    </span>
  );
}
