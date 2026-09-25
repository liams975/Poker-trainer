import type { TodaySnapshot } from '@/lib/progress/queries';

import { cn } from '@/lib/utils';

import { GoalRing } from './goal-ring';

/**
 * The TODAY strip: streak, daily goal, XP level, accuracy trend.
 *
 * Every figure is derived, never a stored counter — XP from the ledger, the
 * streak from its pair plus today's date in the user's own timezone, accuracy
 * from the skill rollup. A brand-new account still shows real zeros, because
 * that is genuinely what it has.
 *
 * Phase 17 sets it as an instrument panel beside the Desk's masthead: four
 * readings under a heavy rule, figures in the display face. The accent is the
 * game layer's — streak and XP — and never enters a range grid.
 */
function Stat({
  label,
  value,
  note,
  extra,
}: {
  label: string;
  value: React.ReactNode;
  note?: string | undefined;
  extra?: React.ReactNode;
}) {
  return (
    // The note lives *inside* the <dd>, not beside it. A <dl>'s grouping <div>
    // may contain only <dt> and <dd> elements — a third sibling breaks the
    // association between term and definition, which axe flags as a serious
    // violation and a screen reader simply reads wrong.
    <div className="flex flex-col gap-3 py-5">
      <dt className="label-caps text-ink-muted">{label}</dt>
      <dd className="flex flex-col gap-3">
        {value}
        {extra}
        {note ? <span className="max-w-56 text-sm text-ink-muted">{note}</span> : null}
      </dd>
    </div>
  );
}

/**
 * A figure in the display face with its unit in italic beside it, the way the
 * problem book sets a measured quantity. No whitespace-only gap is lost: the
 * text still reads "6 days" and "0 / 20" to anything that reads it.
 */
function Figure({
  value,
  unit,
  accent = false,
  size = 'lg',
}: {
  value: React.ReactNode;
  unit?: string;
  accent?: boolean;
  size?: 'lg' | 'md';
}) {
  return (
    <span
      className={cn(
        'font-display leading-[0.9] tracking-[-0.02em]',
        size === 'lg' ? 'text-6xl' : 'text-5xl',
        accent ? 'text-accent' : 'text-ink',
      )}
    >
      {value}
      {unit ? (
        <>
          {' '}
          <i className="text-2xl tracking-normal text-ink-muted">{unit}</i>
        </>
      ) : null}
    </span>
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

  const level = unavailable ? null : snapshot.xp.level;

  return (
    <section
      aria-labelledby="today-heading"
      className="flex flex-col border-t-2 border-ink"
      data-testid="today-strip"
    >
      <h2 id="today-heading" className="label-caps pt-3.5 text-ink">
        Today
      </h2>

      <dl className="grid grid-cols-2 gap-x-8">
        <Stat
          label="Streak"
          value={
            <Figure
              value={unavailable ? '—' : snapshot.streak.current}
              {...(unavailable ? {} : { unit: snapshot.streak.current === 1 ? 'day' : 'days' })}
              accent
            />
          }
          {...(unavailable ? {} : { note: streakNote(snapshot) })}
        />

        <Stat
          label="Daily goal"
          value={
            unavailable ? (
              <Figure value="—" />
            ) : (
              <Figure value={snapshot.dailyGoal.done} unit={`/ ${snapshot.dailyGoal.target}`} />
            )
          }
          extra={
            unavailable ? null : (
              <GoalRing done={snapshot.dailyGoal.done} target={snapshot.dailyGoal.target} />
            )
          }
        />

        <div className="col-span-2 h-px bg-line" aria-hidden="true" />

        <Stat
          label={level ? `XP · level ${level.level}` : 'XP'}
          value={
            <Figure value={unavailable ? '—' : snapshot.xp.total.toLocaleString('en-GB')} accent size="md" />
          }
          extra={
            level ? (
              <span className="block h-[3px] w-full bg-line-soft" aria-hidden="true">
                <span
                  className="block h-full bg-accent"
                  style={{ width: `${level.needed === 0 ? 0 : Math.min(1, level.into / level.needed) * 100}%` }}
                />
              </span>
            ) : null
          }
          {...(level
            ? { note: `Level ${level.level} · ${level.into} of ${level.needed} to the next` }
            : {})}
        />

        {/* An em dash, not "0%": zero accuracy and no data are different
            claims, and the second one is the true one for a new account. */}
        <Stat
          label="Accuracy"
          value={
            <Figure
              value={unavailable || snapshot.accuracy === null ? '—' : Math.round(snapshot.accuracy * 100)}
              {...(unavailable || snapshot.accuracy === null ? {} : { unit: '%' })}
              size="md"
            />
          }
          {...(unavailable || snapshot.accuracy === null
            ? {}
            : { note: 'Recent, across every skill you have drilled.' })}
        />
      </dl>
    </section>
  );
}
