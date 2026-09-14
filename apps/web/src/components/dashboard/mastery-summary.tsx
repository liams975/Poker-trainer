import { MASTERY_LEVELS, RANK_MIN_SPOTS } from '@poker/engine';
import Link from 'next/link';

import { LevelPips } from '@/components/mastery/level-pips';
import { rankName } from '@/components/mastery/rank-ladder';
import type { MasterySnapshot } from '@/lib/progress/types';

/**
 * Rank and mastery on the study desk — the middle of frame 2b.
 *
 * A summary, not a second copy of `/mastery`: where the reader stands, how far
 * the climb has gone, and the two skills worth drilling next. The full map is
 * one click away and this deliberately does not try to be it.
 *
 * Degrades to a null render rather than an error. The dashboard's stated
 * posture is that each section fails on its own — a stats query that times out
 * must not stop somebody starting a drill.
 */
export function MasterySummary({ snapshot }: { snapshot: MasterySnapshot | null }) {
  if (snapshot === null) return null;

  /**
   * Weakest first, and only skills that have been unlocked. A locked skill is
   * always "weakest" by EV and would crowd out every real answer — the reader
   * cannot drill what the curriculum has not opened yet.
   */
  const weakest = [...snapshot.skills]
    .filter((skill) => !skill.locked && skill.level < MASTERY_LEVELS)
    .sort((a, b) => b.evLossPerSpot - a.evLossPerSpot)
    .slice(0, 2);

  return (
    <section
      aria-labelledby="mastery-summary-heading"
      className="flex flex-col gap-4 rounded-[var(--radius)] border border-line bg-surface p-5"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mastery-summary-heading" className="font-display text-xl">
          Mastery
        </h2>
        <p className="font-mono text-xs text-ink-muted">
          {snapshot.levelsEarned} of {snapshot.levelsAvailable} levels ·{' '}
          {snapshot.skills.length} skills
        </p>
      </header>

      <p className="text-sm">
        {snapshot.rank ? (
          <>
            <span className="text-accent-hi">{rankName(snapshot.rank)}</span>
            <span className="text-ink-muted">
              {' '}
              — {snapshot.rank.evLossPerSpot.toFixed(2)}bb lost per spot
              {snapshot.rank.next
                ? `. ${snapshot.rank.next.tier} is ${snapshot.rank.next.gap.toFixed(2)} away.`
                : '. Nothing above this.'}
            </span>
          </>
        ) : (
          <span className="text-ink-muted">
            Ranked after {RANK_MIN_SPOTS} graded answers — long enough that the tier means
            something.
          </span>
        )}
      </p>

      {weakest.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {weakest.map((skill) => (
            <li key={skill.skillTag} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">{skill.label}</span>
              <span className="flex shrink-0 items-center gap-2">
                <LevelPips level={skill.level} />
                <span className="w-6 font-mono text-xs text-ink-muted">L{skill.level}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <Link
        href="/mastery"
        className="text-sm text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
      >
        The whole map
      </Link>
    </section>
  );
}
