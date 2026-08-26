import type { ActionFreq, HandDiff, HandNotation, Rationale } from '@poker/engine';
import { comboCountOf } from '@poker/engine';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

import { actionLabel, actionStyle } from './action-colors';
import { RationaleChips } from './rationale-chips';

/**
 * The detail panel: exact frequencies, combo count, structured rationale.
 *
 * Never reduces the hand to one action. docs/05-ui-ux.md: "Always show the mix,
 * never a bare right/wrong", and the domain rule behind it — teaching that
 * `AJo` "is a fold" when it opens 40% of the time actively makes someone a
 * worse player.
 */

export interface HandDetailProps {
  hand: HandNotation | null;
  frequencies: readonly ActionFreq[] | null;
  rationale: Rationale | null;
  /** Present in compare mode when the two charts differ on this hand. */
  diff?: HandDiff | undefined;
  comparisonLabel?: string | undefined;
}

export function HandDetail({
  hand,
  frequencies,
  rationale,
  diff,
  comparisonLabel,
}: HandDetailProps) {
  if (!hand || !frequencies) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Hand detail</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState>
            Pick a hand from the grid — click it, or Tab to the grid and use the arrow keys.
          </EmptyState>
        </CardContent>
      </Card>
    );
  }

  const combos = comboCountOf(hand);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="font-mono">{hand}</span>
        </CardTitle>
        <p className="text-sm text-ink-muted">
          {combos} {combos === 1 ? 'combo' : 'combos'} · {((combos / 1326) * 100).toFixed(1)}% of
          all hands
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <section aria-labelledby="mix-heading" className="flex flex-col gap-2">
          <h4 id="mix-heading" className="text-xs uppercase tracking-wider text-ink-muted">
            Strategy
          </h4>
          <ul className="flex flex-col gap-1.5">
            {frequencies.map((entry) => (
              <li
                key={`${entry.action}-${entry.size ?? ''}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 rounded-[2px]"
                    style={{ backgroundColor: actionStyle(entry.action).hex }}
                  />
                  <span>{actionLabel(entry.action, entry.size)}</span>
                </span>
                <span className="font-mono text-ink-muted">
                  {(entry.freq * 100).toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </section>

        {diff && diff.distance > 0 ? (
          <section aria-labelledby="diff-heading" className="flex flex-col gap-2">
            <h4 id="diff-heading" className="text-xs uppercase tracking-wider text-ink-muted">
              Change{comparisonLabel ? ` vs ${comparisonLabel}` : ''}
            </h4>
            <ul className="flex flex-col gap-1.5">
              {diff.deltas.map((delta) => (
                <li
                  key={`${delta.action}-${delta.size ?? ''}`}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span>{actionLabel(delta.action, delta.size)}</span>
                  <span className="font-mono text-ink-muted">
                    {delta.delta > 0 ? '+' : ''}
                    {(delta.delta * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
            {diff.primaryChanged ? (
              <p className="text-xs text-ink-muted">The most common action differs.</p>
            ) : null}
          </section>
        ) : null}

        {rationale && rationale.factors.length > 0 ? (
          <section aria-labelledby="why-heading" className="flex flex-col gap-2">
            <h4 id="why-heading" className="text-xs uppercase tracking-wider text-ink-muted">
              Why
            </h4>
            {/* Factor chips, not prose. Shared with the drill's feedback panel
                so the explorer and the trainer describe a factor identically —
                Phase 7 renders the same data concisely in Drill Mode. */}
            <RationaleChips rationale={rationale} />
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
