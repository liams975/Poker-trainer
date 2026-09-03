'use client';

import { rebuildSpot } from '@poker/engine';
import { useState } from 'react';

import { actionLabel } from '@/components/range/action-colors';
import { orderedMix, percent } from '@/components/range/mix-format';
import { TIER_STYLES } from '@/components/drill/grade-tiers';
import { SpotView } from '@/components/drill/spot-view';
import type { AttemptRow as Attempt } from '@/lib/review/filters';

/**
 * One answer from the past, and — when opened — the spot it was given in.
 *
 * **The distribution shown is the one stored on the row**, not one re-derived
 * from today's charts. `drill_attempts.frequencies` and `chart_version` exist
 * precisely so that history stays interpretable when a chart is retuned
 * (docs/01-architecture.md); re-grading here would let a content edit silently
 * rewrite what you were told at the time.
 *
 * **And it never names a right answer.** docs/05: "Never tell a user they were
 * wrong when they chose a positive-frequency action." The row shows what they
 * chose, what share of the mix that was, and the whole mix beside it. There is
 * no ✓/✗ column, because for two of the four tiers there is nothing to tick.
 */
export function AttemptRow({ attempt, currentChartVersion }: {
  attempt: Attempt;
  /** When this differs from the attempt's, the charts have moved since. */
  currentChartVersion: string;
}) {
  const [open, setOpen] = useState(false);
  const style = TIER_STYLES[attempt.grade];

  const mix = orderedMix(attempt.frequencies);
  const chosen = attempt.frequencies.find(
    (entry) =>
      entry.action === attempt.userAction &&
      (attempt.userSize === null || entry.size === undefined || entry.size === attempt.userSize),
  );
  const stale = attempt.chartVersion !== currentChartVersion;

  // `rebuildSpot` refuses a scenario that does not describe a real spot, and a
  // row written before a schema change might. A row that cannot be replayed is
  // still worth listing.
  let spot;
  try {
    spot = rebuildSpot(attempt.scenario);
  } catch {
    spot = null;
  }

  return (
    <li className="rounded-[var(--radius)] border border-line bg-surface" data-testid="attempt-row">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-4 py-3 text-left"
        disabled={spot === null}
      >
        <span
          className="flex w-32 shrink-0 items-center gap-2 text-sm"
          data-tier={attempt.grade}
        >
          <span aria-hidden="true" style={{ color: style.hex }}>
            {style.glyph}
          </span>
          <span>{style.label}</span>
        </span>

        <span className="w-16 shrink-0 font-mono text-sm">{attempt.hand}</span>

        <span className="w-40 shrink-0 text-sm text-ink-muted">
          {attempt.scenario.heroPosition} · {attempt.scenario.actionSequence}
        </span>

        <span className="flex-1 text-sm text-ink-muted">
          You {actionLabel(attempt.userAction as never, attempt.userSize ?? undefined)}
          {chosen ? ` — ${percent(chosen.freq)} of the mix` : ' — not in the mix'}
        </span>

        <span className="w-20 shrink-0 text-right font-mono text-xs text-ink-muted">
          {attempt.evLoss > 0 ? `−${attempt.evLoss.toFixed(2)}bb` : '—'}
        </span>
      </button>

      {open && spot ? (
        <div className="border-t border-line p-4">
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
            <SpotView spot={spot} />

            <div className="flex flex-col gap-3">
              <h3 className="text-xs uppercase tracking-wider text-ink-muted">
                The mix, as it was graded
              </h3>

              <ul className="flex flex-col gap-1.5" data-testid="stored-mix">
                {mix.map((entry) => (
                  <li key={`${entry.action}-${entry.size ?? ''}`} className="flex items-center gap-3 text-sm">
                    <span className="w-32 shrink-0">{actionLabel(entry.action, entry.size)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-raised">
                      <span
                        className="block h-full bg-ink-muted"
                        style={{ width: `${entry.freq * 100}%` }}
                      />
                    </span>
                    <span className="w-14 shrink-0 text-right font-mono text-xs text-ink-muted">
                      {percent(entry.freq)}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="text-xs text-ink-muted">
                Graded against chart set{' '}
                <span className="font-mono">{attempt.chartVersion}</span>
                {stale ? ' — the charts have been retuned since, so this is what you were shown at the time, not what the app would say today.' : '.'}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}
