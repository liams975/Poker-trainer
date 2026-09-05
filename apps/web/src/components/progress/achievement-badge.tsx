'use client';

import type { Achievement } from '@poker/engine';
import { m } from 'motion/react';

/**
 * An unlocked achievement.
 *
 * Phase 9 wrote this as "deliberately quiet — a bordered line of text, not an
 * animation", reading docs/05's "a coach nodding, not a slot machine" as
 * forbidding any movement at all. Phase 11 draws the line one step in: an
 * unlock is a **milestone**, and milestones are exactly the things that are
 * unambiguously achievements. What stays forbidden is celebrating an individual
 * answer, because two of the four grade tiers are correct answers to a mixed
 * spot and a flourish on one of them would say otherwise.
 *
 * So the badge lands, and the ★ arrives a beat after it. No particles, no
 * sound, nothing that repeats. It still carries a glyph alongside the accent,
 * so the unlocked state is never encoded by colour alone.
 */
export function AchievementBadge({
  achievement,
  delay = 0,
}: {
  achievement: Achievement;
  /** Staggers a batch, so three unlocks read as three things. */
  delay?: number;
}) {
  return (
    <m.li
      className="flex items-start gap-3 rounded-[var(--radius)] border border-line bg-surface-raised px-3 py-2"
      data-testid="achievement"
      data-achievement={achievement.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <m.span
        aria-hidden="true"
        className="mt-0.5 text-accent"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, delay: delay + 0.14, ease: [0.34, 1.56, 0.64, 1] }}
      >
        ★
      </m.span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-ink">{achievement.title}</span>
        <span className="text-xs text-ink-muted">{achievement.description}</span>
      </span>
    </m.li>
  );
}
