'use client';

import type { GradeTier, SessionSummary as Summary } from '@poker/engine';
import { GRADE_TIERS } from '@poker/engine';
import Link from 'next/link';

import { AchievementBadge } from '@/components/progress/achievement-badge';
import { Button } from '@/components/ui/button';
import { percent } from '@/components/range/mix-format';
import type { SessionRewards } from '@/lib/progress/types';

import { TIER_STYLES } from './grade-tiers';

/**
 * The end of a session.
 *
 * **No single accuracy score.** docs/03-poker-engine.md: "Score by EV loss, not
 * accuracy percentage." Two of the four tiers are defensible answers rather
 * than partial credit, so a headline "78% correct" would re-assert exactly the
 * binary framing the tiers exist to reject — and would count a genuine 50/50
 * hand as a miss half the time.
 *
 * The tone is docs/05's: "a coach nodding, not a slot machine paying out." No
 * confetti, no celebration copy.
 */
function tierNote(tier: GradeTier): string {
  switch (tier) {
    case 'optimal':
      return 'the highest-frequency line';
    case 'acceptable':
      return 'a real part of the mix';
    case 'inaccurate':
      return 'a thin part of the mix';
    case 'blunder':
      return 'not in the mix here';
  }
}

/**
 * What the session earned, in one line.
 *
 * Every figure here came back from the server that wrote it. The client could
 * add the tiers up itself and get the same number today — but two arithmetics
 * over one schedule is how a summary ends up congratulating somebody on XP the
 * ledger never received, and the ledger is the thing every later screen reads.
 */
function Rewards({ rewards }: { rewards: SessionRewards }) {
  const { streak } = rewards;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="rewards-heading">
      <h3 id="rewards-heading" className="text-xs uppercase tracking-wider text-ink-muted">
        Banked
      </h3>

      <p className="text-sm text-ink" data-testid="session-rewards">
        <span className="font-mono text-accent" data-testid="xp-awarded">
          +{rewards.xpAwarded} XP
        </span>{' '}
        <span className="text-ink-muted">
          · level {rewards.level.level} · {rewards.level.into} of {rewards.level.needed} to the
          next
        </span>
      </p>

      <p className="text-sm text-ink-muted" data-testid="session-streak">
        {streak.extendedToday
          ? `${streak.current}-day streak${streak.current === streak.longest && streak.current > 1 ? ' — your best yet' : ''}.`
          : `${streak.current}-day streak, already counted today.`}
      </p>

      {rewards.dailyGoal.met ? (
        /* Not "114 of 20 spots" — once the goal is met the target stops being
           the interesting number, and reading a total against a smaller
           denominator is just wrong. */
        <p className="text-sm text-ink-muted" data-testid="daily-goal-met">
          Daily goal met — {rewards.dailyGoal.done}{' '}
          {rewards.dailyGoal.done === 1 ? 'spot' : 'spots'} today.
        </p>
      ) : (
        <p className="text-sm text-ink-muted" data-testid="daily-goal-progress">
          {rewards.dailyGoal.done} of {rewards.dailyGoal.target} spots today.
        </p>
      )}

      {rewards.unlocked.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="unlocked-achievements">
          {rewards.unlocked.map((achievement) => (
            <AchievementBadge key={achievement.id} achievement={achievement} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function SessionSummary({
  summary,
  studyMode,
  rewards,
  onRestart,
}: {
  summary: Summary;
  studyMode: boolean;
  /** Null for a study session, a session with no answers, or a repeated close. */
  rewards: SessionRewards | null;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-col gap-6 rounded-[var(--radius)] border border-line bg-surface p-6">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold">Session complete</h2>
        <p className="text-sm text-ink-muted">
          {summary.spots} {summary.spots === 1 ? 'spot' : 'spots'} ·{' '}
          <span className="font-mono">{summary.totalEvLoss}bb</span> total EV lost ·{' '}
          <span className="font-mono">{summary.avgEvLoss}bb</span> per spot
        </p>
      </header>

      <section className="flex flex-col gap-2" aria-labelledby="tiers-heading">
        <h3 id="tiers-heading" className="text-xs uppercase tracking-wider text-ink-muted">
          How your answers landed
        </h3>

        <ul className="flex flex-col gap-1.5" data-testid="tier-breakdown">
          {GRADE_TIERS.map((tier) => {
            const count = summary.byTier[tier];
            const style = TIER_STYLES[tier];
            const share = summary.spots === 0 ? 0 : count / summary.spots;

            return (
              <li key={tier} className="flex items-center gap-3 text-sm" data-tier={tier}>
                <span className="flex w-36 shrink-0 items-center gap-2">
                  <span aria-hidden="true" style={{ color: style.hex }}>
                    {style.glyph}
                  </span>
                  <span>{style.label}</span>
                </span>

                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-raised">
                  <span
                    className="block h-full"
                    style={{ width: `${share * 100}%`, backgroundColor: style.hex }}
                  />
                </span>

                <span className="w-24 shrink-0 text-right font-mono text-xs text-ink-muted">
                  {count} · {percent(share)}
                </span>

                <span className="hidden w-44 shrink-0 text-xs text-ink-muted lg:inline">
                  {tierNote(tier)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {rewards ? <Rewards rewards={rewards} /> : null}

      {studyMode ? (
        <p className="text-sm text-ink-muted">
          Study session — recorded in your history, but kept out of your XP, your accuracy
          and your weak spots. It still counts towards your streak.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onRestart}>
          Drill again
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
