import type { Achievement } from '@poker/engine';

/**
 * An unlocked achievement.
 *
 * Deliberately quiet. docs/05-ui-ux.md sets the tone as "a coach nodding, not a
 * slot machine paying out" and rules out celebratory confetti — so this is a
 * bordered line of text with the accent used once, not an animation. It also
 * respects the palette rule by carrying a glyph as well as a colour, though
 * nothing here encodes a strategy action.
 */
export function AchievementBadge({ achievement }: { achievement: Achievement }) {
  return (
    <li
      className="flex items-start gap-3 rounded-[var(--radius)] border border-line bg-surface-raised px-3 py-2"
      data-testid="achievement"
      data-achievement={achievement.id}
    >
      <span aria-hidden="true" className="mt-0.5 text-accent">
        ★
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-ink">{achievement.title}</span>
        <span className="text-xs text-ink-muted">{achievement.description}</span>
      </span>
    </li>
  );
}
