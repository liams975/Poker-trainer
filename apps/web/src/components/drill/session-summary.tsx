'use client';

import type { GradeTier, SessionSummary as Summary } from '@poker/engine';
import { GRADE_TIERS } from '@poker/engine';
import { m } from 'motion/react';
import Link from 'next/link';

import { AchievementBadge } from '@/components/progress/achievement-badge';
import { CountUp } from '@/components/progress/count-up';
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
/**
 * The milestone moments.
 *
 * Phase 11's tone decision, and the line it draws: **a level-up, an achievement
 * or a streak record gets a real moment; an individual answer never does.**
 *
 * That is not a softening of docs/05's "a coach nodding, not a slot machine".
 * It is where the metaphor actually points. A coach does not applaud a hand you
 * played fine — two of the four tiers are correct answers to a mixed spot, so
 * there is nothing there to applaud — but a coach absolutely does mark the week
 * you finally strung seven days together. The milestones are the things that
 * are unambiguously achievements; the answers are not, and that is the whole
 * distinction.
 */
function Milestone({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.34, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </m.div>
  );
}

function Rewards({ rewards }: { rewards: SessionRewards }) {
  const { streak } = rewards;

  const leveledUp = rewards.level.level > rewards.levelBefore;
  const bestStreak =
    streak.extendedToday && streak.current === streak.longest && streak.current > 1;

  // The bar the XP is filling. Capped, because `into` can equal `needed` on the
  // exact boundary and a bar over 100% renders past its track.
  const intoLevel =
    rewards.level.needed === 0 ? 0 : Math.min(1, rewards.level.into / rewards.level.needed);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="rewards-heading">
      <h3 id="rewards-heading" className="text-xs uppercase tracking-wider text-ink-muted">
        Banked
      </h3>

      <div className="flex flex-col gap-2" data-testid="session-rewards">
        <p className="text-sm text-ink">
          <CountUp
            to={rewards.xpAwarded}
            className="font-mono text-accent"
            prefix="+"
            suffix=" XP"
          />{' '}
          <span className="text-ink-muted">
            · level {rewards.level.level} · {rewards.level.into} of {rewards.level.needed} to the
            next
          </span>
        </p>

        {/* The number above, as a bar filling. Accent is allowed here: docs/05
            reserves it for the streak and XP rail, and this is the XP rail. */}
        <span
          className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-surface-raised"
          aria-hidden="true"
        >
          <m.span
            className="block h-full bg-accent"
            initial={{ width: 0 }}
            animate={{ width: `${intoLevel * 100}%` }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        </span>

        {/* Kept as its own node with the old test id: the e2e suite asserts the
            exact integer here, and a count-up would make it flaky. */}
        <span className="sr-only" data-testid="xp-awarded">
          +{rewards.xpAwarded} XP
        </span>
      </div>

      {leveledUp ? (
        <Milestone>
          {/* `inline-block`, so the badge hugs its sentence. Full width it read
              as an alert bar across the card rather than as a thing earned. */}
          <p
            className="inline-block rounded-[var(--radius)] border border-accent/40 bg-surface-raised px-3 py-2 text-sm text-ink"
            data-testid="level-up"
          >
            <span aria-hidden="true" className="mr-2 text-accent">
              ▲
            </span>
            Level {rewards.level.level}. That is {rewards.level.level - rewards.levelBefore}{' '}
            {rewards.level.level - rewards.levelBefore === 1 ? 'level' : 'levels'} this session.
          </p>
        </Milestone>
      ) : null}

      <p className="text-sm text-ink-muted" data-testid="session-streak">
        {streak.extendedToday
          ? `${streak.current}-day streak${bestStreak ? ' — your best yet' : ''}.`
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
        // Staggered, one after another, so unlocking three reads as three
        // things rather than one block appearing.
        <ul className="flex flex-col gap-2" data-testid="unlocked-achievements">
          {rewards.unlocked.map((achievement, index) => (
            <AchievementBadge
              key={achievement.id}
              achievement={achievement}
              delay={0.12 + index * 0.12}
            />
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
