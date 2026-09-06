'use client';

import type { HandResult, HeroDecision, Position } from '@poker/engine';

import { TIER_STYLES, tierMessage } from '@/components/drill/grade-tiers';
import { actionLabel } from '@/components/range/action-colors';
import { orderedMix, percent } from '@/components/range/mix-format';

/**
 * What just happened, and — where a chart reaches — how you played it.
 *
 * ## Why most of this screen has no grade on it
 *
 * The seeded content is ten charts: RFI for five seats, and big-blind defence
 * against five single openers. Hero is in charted territory only when first in,
 * or defending the blind against exactly one open. A hand played to the river
 * passes through a dozen decisions and at most one of them can be marked.
 *
 * So the uncharted ones say so, in words, rather than being hidden or quietly
 * scored. Hiding them would make the screen look like it had graded a hand it
 * had barely looked at. Scoring them would mean grading against
 * `createHeuristicStrategy` — the bot's invented logic — which is precisely
 * what `heuristics.ts` refused to ship for four phases and what 12a built the
 * heuristic on the promise of never doing.
 *
 * Saying it out loud has a third benefit: it makes the missing charts visible
 * as a hole in the product rather than a line in `docs/02-roadmap.md`.
 *
 * ## And no verdict on the hand itself
 *
 * Winning a pot is not playing well and losing one is not playing badly. The
 * net is reported as a number with no framing, which is the same rule the four
 * grade tiers encode: `docs/05-ui-ux.md` forbids telling somebody they were
 * wrong for choosing a positive-frequency action, and forbids celebrating an
 * individual answer. A hand is one sample.
 */

const UNCHARTED_COPY: Readonly<Record<NonNullable<HeroDecision['uncharted']>, string>> = {
  postflop: 'Postflop — no chart covers this, so it is reported, not graded.',
  'no-chart': 'No chart covers this spot yet.',
};

function Decision({ decision }: { decision: HeroDecision }) {
  const { grade, frequencies } = decision;
  const style = grade === undefined ? null : TIER_STYLES[grade.tier];

  return (
    <li
      className="flex flex-col gap-2 rounded-[var(--radius)] border border-line bg-surface p-3"
      data-testid="hand-decision"
      data-street={decision.street}
      data-graded={grade === undefined ? undefined : ''}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xs uppercase tracking-wider text-ink-muted">
          {decision.street}
        </span>
        <span className="text-sm text-ink">
          You {actionLabel(decision.action.action, decision.action.size)}
        </span>
        <span className="ml-auto font-mono text-xs text-ink-muted">{decision.pot}bb pot</span>
      </div>

      {style === null || grade === undefined ? (
        <p className="text-xs text-ink-muted" data-testid="uncharted">
          {UNCHARTED_COPY[decision.uncharted ?? 'no-chart']}
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm" data-tier={grade.tier}>
            <span aria-hidden="true" style={{ color: style.hex }}>
              {style.glyph}
            </span>
            <span>{style.label}</span>
          </p>
          <p className="text-xs text-ink-muted">
            {tierMessage(grade, {
              action: decision.action.action,
              ...(decision.action.size === undefined ? {} : { size: decision.action.size }),
            })}
          </p>

          {/* The whole mix, always. "Teaching someone that AJo *is a fold* when
              it opens 40% of the time actively makes them a worse player." */}
          <ul className="flex flex-col gap-1">
            {orderedMix(frequencies ?? []).map((entry) => (
              <li
                key={`${entry.action}-${entry.size ?? ''}`}
                className="flex items-center gap-2 text-xs"
              >
                <span className="w-28 shrink-0 text-ink-muted">
                  {actionLabel(entry.action, entry.size)}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised">
                  <span
                    className="block h-full bg-ink-muted"
                    style={{ width: `${entry.freq * 100}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-ink-muted">
                  {percent(entry.freq)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

export function HandSummary({
  result,
  hero,
  decisions,
  recordingError,
}: {
  result: HandResult;
  hero: Position;
  decisions: readonly HeroDecision[];
  /** Set when the hand could not be written. Play is unaffected. */
  recordingError?: string | null;
}) {
  const payout = result.payouts.find((entry) => entry.position === hero);
  const net = payout?.net ?? 0;
  const showdown = result.showdown !== undefined;

  return (
    <section className="flex flex-col gap-4" data-testid="hand-summary">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-sm font-semibold">Hand over</h2>
        <p className="font-mono text-2xl text-ink" data-testid="hero-net">
          {net > 0 ? '+' : ''}
          {net.toFixed(2)}bb
        </p>
        <p className="text-xs text-ink-muted">
          {showdown
            ? 'Showdown — the cards that had to be shown are face up on the table.'
            : 'Everyone folded, so no cards were shown.'}
        </p>
      </div>

      {recordingError === null || recordingError === undefined ? null : (
        <p
          className="rounded-[var(--radius)] border border-line bg-surface p-3 text-xs text-ink-muted"
          data-testid="recording-error"
        >
          This hand was played but not saved — {recordingError}
        </p>
      )}

      {decisions.length === 0 ? (
        <p className="text-xs text-ink-muted">
          You had no decision to make this hand.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs uppercase tracking-wider text-ink-muted">Your decisions</h3>
          <ul className="flex flex-col gap-2">
            {decisions.map((decision, index) => (
              <Decision key={`${decision.street}-${index}`} decision={decision} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
