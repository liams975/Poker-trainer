'use client';

import type { GradeTier, SessionSummary as Summary } from '@poker/engine';
import { GRADE_TIERS } from '@poker/engine';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { percent } from '@/components/range/mix-format';

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

export function SessionSummary({
  summary,
  studyMode,
  onRestart,
}: {
  summary: Summary;
  studyMode: boolean;
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

      {studyMode ? (
        <p className="text-sm text-ink-muted">
          Study session — recorded in your history, but kept out of your accuracy stats.
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
