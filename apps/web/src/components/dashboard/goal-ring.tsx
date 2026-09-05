'use client';

import { m } from 'motion/react';

/**
 * The daily goal, as a ring.
 *
 * docs/05-ui-ux.md puts a "daily goal ring" in the TODAY strip, and reserves
 * the accent colour for this strip and the rail — "never appears in a range
 * grid". This is one of the two places it is allowed.
 *
 * An SVG rather than a conic gradient, because the ring has to carry a label
 * for a screen reader and a gradient has nothing to attach one to. Colour is
 * not the only encoding either way: the fraction is written in the middle.
 */
export function GoalRing({ done, target }: { done: number; target: number }) {
  const size = 44;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  // Capped at 1: somebody who drilled 60 spots has met the goal, not 300% of it.
  const share = target === 0 ? 0 : Math.min(1, done / target);
  const met = done >= target && target > 0;

  return (
    <span
      className="relative inline-flex items-center justify-center"
      role="img"
      aria-label={
        met
          ? `Daily goal met: ${done} of ${target} spots`
          : `Daily goal: ${done} of ${target} spots`
      }
      data-testid="goal-ring"
      data-met={met}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-surface-raised)"
          strokeWidth={stroke}
        />
        {/* Fills to today's share on mount rather than being drawn at it. One
            line, and the largest change in felt quality per character anywhere
            in the app — the dashboard's first frame now does something. */}
        <m.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - share) }}
          transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          // Starts at twelve o'clock rather than three.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>

      {/* A tick, not the fraction. The fraction is written beside the ring
          already, and at 44px "104/20" overflows the circle it sits in. A glyph
          also keeps the met state from being carried by colour alone. */}
      {met ? (
        <span className="absolute text-accent" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </span>
  );
}
