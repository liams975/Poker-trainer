import { MASTERY_LEVELS } from '@poker/engine';

import type { SkillMastery } from '@/lib/progress/types';
import { cn } from '@/lib/utils';

import { LevelPips } from './level-pips';

/**
 * The mastery map — frame 2g.
 *
 * Every skill the curriculum teaches, whether or not the reader has touched it.
 * A skill at L0 shows as locked with what it needs, because the deck's own rule
 * for the badge gallery applies here too: a goal whose shape you cannot see is
 * not a goal.
 */
export function MasteryMap({
  skills,
  levelsEarned,
  levelsAvailable,
}: {
  skills: readonly SkillMastery[];
  levelsEarned: number;
  levelsAvailable: number;
}) {
  return (
    <section aria-labelledby="mastery-heading" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mastery-heading" className="font-display text-2xl">
          Mastery
        </h2>
        <p className="font-mono text-xs text-ink-muted">
          {levelsEarned} of {levelsAvailable} levels · {skills.length} skills
        </p>
      </header>

      <p className="max-w-prose text-sm text-ink-muted">
        {skills.length} skills, {MASTERY_LEVELS} levels each. A level needs 30 graded answers with
        EV lost under the level&rsquo;s threshold — so a level cannot be ground out by volume
        alone, and it can drop back.
      </p>

      <ul className="flex flex-col">
        {skills.map((skill) => (
          <li
            key={skill.skillTag}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-3 last:border-b-0"
          >
            <span className={cn('min-w-56 flex-1 text-sm', skill.locked && 'text-ink-muted')}>
              {skill.label}
            </span>

            <LevelPips level={skill.level} />

            <span
              className={cn(
                'w-8 font-mono text-xs',
                skill.level === MASTERY_LEVELS ? 'text-accent-hi' : 'text-ink',
                skill.locked && 'text-ink-muted',
              )}
            >
              L{skill.level}
            </span>

            <span className="min-w-48 text-right font-mono text-xs text-ink-muted">
              {describeNext(skill)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What this skill needs next, in words.
 *
 * The locked case deliberately names the shortfall in answers rather than in EV,
 * because at L0 the reader has no window to compare against yet — telling them
 * "get under 0.55" before they have drilled thirty spots describes a bar they
 * cannot yet see themselves against.
 */
function describeNext(skill: SkillMastery): string {
  if (skill.level === MASTERY_LEVELS) return 'mastered';

  if (skill.locked) {
    const remaining = 30 - skill.attempts;
    return remaining > 0 ? `locked — ${remaining} more answers` : 'locked — under the bar';
  }

  return skill.next ? `L${skill.next.level} under ${skill.next.evLossPerSpot}bb` : '';
}
