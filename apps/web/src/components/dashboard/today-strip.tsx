import type { TodaySnapshot } from '@/lib/progress/queries';

import { GoalRing } from './goal-ring';

/**
 * The TODAY strip: streak, daily goal, XP level, accuracy trend.
 *
 * Every figure is derived, never a stored counter — XP from the ledger, the
 * streak from its pair plus today's date in the user's own timezone, accuracy
 * from the skill rollup. A brand-new account still shows real zeros, because
 * that is genuinely what it has.
 *
 * The accent colour is used here and in the rail, and nowhere else. docs/05
 * reserves it for exactly this: "streak and XP rail ONLY. Never appears in a
 * range grid."
 */
function Stat({
  label,
  value,
  accent = false,
  note,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  note?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className={`font-mono text-xl ${accent ? 'text-accent' : 'text-ink'}`}>{value}</dd>
      {note ? <p className="max-w-48 text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}

/**
 * What to say about the streak.
 *
 * docs/04-data-model.md warns that "why did my streak break?" is the commonest
 * support complaint in this category, and Phase 9 settled the rule as strict —
 * one missed day resets it. The mitigation is not a grace period, it is saying
 * so while there is still time to act: `at_risk` means yesterday counted and
 * today has not.
 */
function streakNote(snapshot: TodaySnapshot): string | undefined {
  const { status, current } = snapshot.streak;

  if (status === 'at_risk') {
    return `Play today to keep your ${current}-day streak.`;
  }
  if (status === 'active' && current > 0) {
    return 'Counted for today.';
  }
  if (status === 'broken' || status === 'none') {
    return snapshot.streak.longest > 0
      ? `Your best is ${snapshot.streak.longest} days. One session starts a new one.`
      : undefined;
  }

  return undefined;
}

export function TodayStrip({ snapshot }: { snapshot: TodaySnapshot | null }) {
  // A progress read that failed should cost the strip, not the dashboard. Zeros
  // would be a claim; an em dash is the truth about what is known right now.
  const unavailable = snapshot === null;

  return (
    <section
      aria-labelledby="today-heading"
      className="rounded-[var(--radius)] border border-line bg-surface px-6 py-4"
      data-testid="today-strip"
    >
      <h2 id="today-heading" className="sr-only">
        Today
      </h2>

      <dl className="flex flex-wrap items-start gap-x-12 gap-y-4">
        <Stat
          label="Streak"
          value={unavailable ? '—' : `${snapshot.streak.current} ${snapshot.streak.current === 1 ? 'day' : 'days'}`}
          accent
          {...(unavailable ? {} : { note: streakNote(snapshot) })}
        />

        <div className="flex flex-col gap-1">
          <dt className="text-xs uppercase tracking-wider text-ink-muted">Daily goal</dt>
          <dd className="flex items-center gap-3">
            {unavailable ? (
              <span className="font-mono text-xl text-ink">—</span>
            ) : (
              <>
                <GoalRing done={snapshot.dailyGoal.done} target={snapshot.dailyGoal.target} />
                <span className="font-mono text-xl text-ink">
                  {snapshot.dailyGoal.done} / {snapshot.dailyGoal.target}
                </span>
              </>
            )}
          </dd>
        </div>

        <Stat
          label="XP"
          value={unavailable ? '—' : snapshot.xp.total.toLocaleString('en-GB')}
          accent
          {...(unavailable
            ? {}
            : {
                note: `Level ${snapshot.xp.level.level} · ${snapshot.xp.level.into} of ${snapshot.xp.level.needed} to the next`,
              })}
        />

        {/* An em dash, not "0%": zero accuracy and no data are different
            claims, and the second one is the true one for a new account. */}
        <Stat
          label="Accuracy"
          value={
            unavailable || snapshot.accuracy === null
              ? '—'
              : `${Math.round(snapshot.accuracy * 100)}%`
          }
          {...(unavailable || snapshot.accuracy === null
            ? {}
            : { note: 'Recent, across every skill you have drilled.' })}
        />
      </dl>
    </section>
  );
}
