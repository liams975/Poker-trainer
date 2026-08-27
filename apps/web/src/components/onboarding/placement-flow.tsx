'use client';

import type { ChartSet, DrillTemplate } from '@poker/engine';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { DrillRunner, type FinishedSession } from '@/components/drill/drill-runner';
import { Button } from '@/components/ui/button';
import { skipPlacement, submitPlacement, type PlacementOutcome } from '@/lib/lessons/client';

/**
 * Onboarding: a short graded drill that decides where in the track to start.
 *
 * The browser runs the spots and sends up a session id. It does not send up a
 * result — docs/01-architecture.md §3 allows client-computed values only where
 * they "never gate money or unlock content", and this decides how much of the
 * course opens. The server reads back the attempts it graded itself.
 *
 * Skipping is offered plainly. Most people skip optional onboarding, and a
 * diagnostic someone resents is worse evidence than no diagnostic at all.
 */

/**
 * Enough answers for a lesson-sized group to clear `PLACEMENT_MIN_ATTEMPTS`.
 *
 * Six groups at three answers each is the floor; spots are drawn at random
 * across templates, so this leaves headroom for an uneven draw. Under-sampling
 * fails safe — an untested group counts as not demonstrated, which places
 * earlier rather than later.
 */
const DIAGNOSTIC_SPOTS = 24;

type Stage = 'intro' | 'drilling' | 'done';

export interface PlacementFlowProps {
  chartSet: ChartSet;
  templates: readonly { id: string; template: DrillTemplate }[];
}

export function PlacementFlow({ chartSet, templates }: PlacementFlowProps) {
  const [stage, setStage] = useState<Stage>('intro');
  const [outcome, setOutcome] = useState<PlacementOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset = useMemo(
    () => ({
      studyMode: false,
      length: DIAGNOSTIC_SPOTS,
      timed: false,
      templateSlugs: templates.map((entry) => entry.template.slug),
    }),
    [templates],
  );

  async function finish(result: FinishedSession): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (result.sessionId === null) throw new Error('the diagnostic did not start properly');
      setOutcome(await submitPlacement(result.sessionId));
      setStage('done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'could not work out your placement');
    } finally {
      setBusy(false);
    }
  }

  async function skip(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await skipPlacement();
      setOutcome({ skillTag: null, byTag: [], startLessonSlug: null });
      setStage('done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'could not finish onboarding');
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'intro') {
    return (
      <div className="flex max-w-2xl flex-col gap-5 rounded-[var(--radius)] border border-line bg-surface p-6">
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-lg font-semibold">Let&rsquo;s find your level</h1>
          <p className="text-sm text-ink-muted">
            {DIAGNOSTIC_SPOTS} preflop spots, a couple of minutes. Nothing here counts against
            you — it only decides which lesson you start on, and you can read any lesson you
            unlock in any order afterwards.
          </p>
        </header>

        <ul className="flex flex-col gap-2 border-l-2 border-line pl-4 text-sm text-ink">
          <li>Answer with the keyboard: F to fold, C to call, R to raise.</li>
          <li>Mixed spots have more than one right answer, and both count.</li>
          <li>If you are new to 6-max, skip this and start at the beginning.</li>
        </ul>

        {error ? <p className="text-sm text-ink">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setStage('drilling')} disabled={busy}>
            Start the diagnostic
          </Button>
          <Button type="button" variant="outline" onClick={() => void skip()} disabled={busy}>
            Skip, start at the beginning
          </Button>
        </div>
      </div>
    );
  }

  if (stage === 'drilling') {
    return (
      <div className="flex flex-col gap-4">
        {busy ? (
          <p className="text-sm text-ink-muted" role="status">
            Working out where to start you…
          </p>
        ) : null}
        {error ? <p className="text-sm text-ink">{error}</p> : null}

        <DrillRunner
          chartSet={chartSet}
          templates={templates}
          mode="placement"
          preset={preset}
          onFinished={(result) => void finish(result)}
        />
      </div>
    );
  }

  const placed = outcome?.startLessonSlug;

  return (
    <div
      className="flex max-w-2xl flex-col gap-5 rounded-[var(--radius)] border border-line bg-surface p-6"
      data-testid="placement-result"
    >
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-lg font-semibold">You&rsquo;re set</h1>
        <p className="text-sm text-ink-muted" data-placement={outcome?.skillTag ?? 'none'}>
          {outcome?.skillTag === null
            ? 'You answered everything the diagnostic covers, so the whole track is open. Start anywhere.'
            : 'Everything up to your starting lesson is unlocked, so you can go back over anything you want to revisit.'}
        </p>
      </header>

      {outcome && outcome.byTag.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-sm" data-testid="placement-evidence">
          {outcome.byTag.map((entry) => (
            <li key={entry.skillTag} className="flex items-baseline gap-2">
              <span aria-hidden="true" className="w-4 text-ink-muted">
                {entry.demonstrated ? '●' : '○'}
              </span>
              <span className="font-mono text-xs text-ink-muted">{entry.skillTag}</span>
              <span className="text-ink-muted">
                {entry.attempts === 0
                  ? 'not tested'
                  : `${entry.passes} of ${entry.attempts}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={placed ? `/learn/${placed}` : '/learn'}>Start learning</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Go to the dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
