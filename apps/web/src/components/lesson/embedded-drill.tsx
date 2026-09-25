'use client';

import type { ChartSet, DrillTemplate, SessionSummary } from '@poker/engine';
import { GRADE_TIERS } from '@poker/engine';
import { useMemo, useState } from 'react';

import { DrillRunner, type FinishedSession } from '@/components/drill/drill-runner';
import { TIER_STYLES } from '@/components/drill/grade-tiers';
import { Button } from '@/components/ui/button';

/**
 * A short drill inside a lesson.
 *
 * This is the whole `DrillRunner` with a preset, not a smaller reimplementation
 * of it. A parallel mini-runner would be easy to write and would eventually
 * grade something differently from the real one — and a teaching app that
 * contradicts itself between the lesson and the trainer is worse than one that
 * teaches nothing.
 *
 * Attempts are recorded under `mode = 'lesson'`, so Phase 9 can tell practice
 * inside a lesson apart from a session someone chose to run.
 */
export interface EmbeddedDrillProps {
  chartSet: ChartSet;
  templates: readonly { id: string; template: DrillTemplate }[];
  templateSlug: string;
  spots: number;
  /** "Exercise 2.2", numbered by the lesson it closes. */
  exercise?: string | undefined;
}

export function EmbeddedDrill({
  chartSet,
  templates,
  templateSlug,
  spots,
  exercise,
}: EmbeddedDrillProps) {
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState<SessionSummary | null>(null);

  const preset = useMemo(
    () => ({
      studyMode: false,
      length: spots,
      timed: false,
      templateSlugs: [templateSlug],
    }),
    [spots, templateSlug],
  );

  const template = templates.find((entry) => entry.template.slug === templateSlug);

  if (template === undefined) {
    // The validator rejects this at sync time; rendered rather than thrown so
    // one bad row cannot take the whole lesson down.
    return (
      <p className="text-sm text-ink-muted">
        This practice set is not available in the published content.
      </p>
    );
  }

  return (
    // Set as the exercise that closes a textbook section: a heavy rule, its
    // number, and what it asks. The region keeps the name "Practice", which is
    // what it is and what the e2e suite finds it by.
    <section className="flex flex-col gap-6 border-t-2 border-ink pt-5" aria-label="Practice">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-2">
          <span className="label-caps text-ink-muted">{exercise ?? 'Practice'}</span>
          <h3 className="font-display text-3xl">
            {spots} spots, <i>{template.template.title.toLowerCase()}</i>
          </h3>
          <p className="text-sm text-ink-muted">
            Graded on four tiers, and the mix is always shown.
          </p>
        </div>

        {!started ? (
          // Outline, not the yellow key: on a lesson page the key is "Mark as
          // complete", and there is one per screen.
          <Button type="button" variant="outline" onClick={() => setStarted(true)}>
            Start practice
          </Button>
        ) : null}
      </header>

      {started && finished === null ? (
        <DrillRunner
          chartSet={chartSet}
          templates={templates}
          mode="lesson"
          preset={preset}
          onFinished={(result: FinishedSession) => setFinished(result.summary)}
        />
      ) : null}

      {finished !== null ? (
        <div className="flex flex-col gap-3" data-testid="embedded-drill-summary">
          <p className="text-base text-ink">
            {finished.spots} spots ·{' '}
            <span className="font-mono">{finished.totalEvLoss}bb</span> EV lost
          </p>

          {/* The tier breakdown, not a score. Two of the four tiers are
              defensible answers, so a single percentage would misreport them. */}
          <ul className="flex flex-wrap gap-3 text-sm">
            {GRADE_TIERS.filter((tier) => finished.byTier[tier] > 0).map((tier) => (
              <li key={tier} className="flex items-center gap-1.5">
                <span aria-hidden="true" style={{ color: TIER_STYLES[tier].hex }}>
                  {TIER_STYLES[tier].glyph}
                </span>
                <span className="text-ink-muted">
                  {TIER_STYLES[tier].label} {finished.byTier[tier]}
                </span>
              </li>
            ))}
          </ul>

          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => {
              setFinished(null);
              setStarted(false);
            }}
          >
            Practise again
          </Button>
        </div>
      ) : null}
    </section>
  );
}
