import type { SessionRewards } from '@/lib/progress/types';

/**
 * The serif line at the top of the summary.
 *
 * A milestone if this session produced one, and a plain statement of fact if it
 * did not. Nothing here reads the tier breakdown: celebrating how the answers
 * landed is exactly what the four-tier model exists to avoid.
 */
export function headline(rewards: SessionRewards | null): string {
  if (rewards === null) return 'Session complete.';

  if (rewards.level.level > rewards.levelBefore) return `Level ${rewards.level.level}.`;

  const unlocked = rewards.unlocked[0];
  if (unlocked) return `${unlocked.title}.`;

  if (rewards.streak.extendedToday && rewards.streak.current === rewards.streak.longest) {
    return `${rewards.streak.current}-day streak, and a new best.`;
  }

  if (rewards.streak.extendedToday) return `${rewards.streak.current} days in a row.`;

  return 'Session complete.';
}
