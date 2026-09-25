import { MASTERY_WINDOW } from '@poker/engine';
import Link from 'next/link';

import { LevelPips } from '@/components/mastery/level-pips';
import { RankLadder } from '@/components/mastery/rank-ladder';
import { SectionHead } from '@/components/ui/section-head';
import type { MasterySnapshot } from '@/lib/progress/types';
import { cn } from '@/lib/utils';

/**
 * Rank and mastery on the study desk — the middle of frame 2b.
 *
 * A summary, not a second copy of `/mastery`: where the reader stands on the
 * rank scale, and every skill's level as one line each. The weekly board and
 * the per-skill detail are one click away, and this deliberately does not try
 * to be them.
 *
 * Degrades to a null render rather than an error. The dashboard's stated
 * posture is that each section fails on its own — a stats query that times out
 * must not stop somebody starting a drill.
 */
export function MasterySummary({ snapshot }: { snapshot: MasterySnapshot | null }) {
  if (snapshot === null) return null;

  return (
    <section aria-labelledby="mastery-summary-heading" className="flex flex-col gap-9">
      <SectionHead
        n={3}
        id="mastery-summary-heading"
        title="Mastery"
        caption={`${snapshot.levelsEarned} of ${snapshot.levelsAvailable} levels · ${snapshot.skills.length} skills`}
      />

      <div className="grid grid-cols-1 gap-x-18 gap-y-12 xl:grid-cols-2">
        <RankLadder rank={snapshot.rank} heading="Rank" headingClassName="label-caps text-ink" />

        <div className="flex flex-col">
          {/* All ten, as small multiples: the whole map at a glance. A skill
              below a full window shows what opens it — answers against the
              window — rather than a score, which is what the engine's
              `locked` flag is for. A missing row would read as a missing
              skill, so every one is listed. */}
          <ul className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
            {snapshot.skills.map((skill) => (
              <li
                key={skill.skillTag}
                className="flex items-center gap-3 border-b border-line-soft py-3"
              >
                <span className={cn('flex-1 truncate text-base', skill.locked && 'text-ink-muted')}>
                  {skill.label}
                </span>
                {skill.locked ? (
                  <span className="font-mono text-xs text-ink-muted">
                    {Math.min(skill.attempts, MASTERY_WINDOW)} of {MASTERY_WINDOW} answers
                  </span>
                ) : (
                  <>
                    <LevelPips level={skill.level} />
                    <span className="w-6 text-right font-mono text-xs text-ink-muted">
                      L{skill.level}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>

          <Link
            href="/mastery"
            className="mt-5 self-start text-base text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
          >
            The whole map →
          </Link>
        </div>
      </div>
    </section>
  );
}
