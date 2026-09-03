import { GRADE_TIERS, type GradeTier } from '@poker/engine';
import { Suspense } from 'react';

import { TrackEvent } from '@/components/analytics/track-event';
import { AccuracyChart } from '@/components/review/accuracy-chart';
import { FilterBar } from '@/components/review/filter-bar';
import { MistakeLog } from '@/components/review/mistake-log';
import { SessionList } from '@/components/review/session-list';
import { Skeleton } from '@/components/ui/skeleton';
import { getCharts } from '@/lib/charts/registry';
import {
  DEFAULT_HISTORY_DAYS,
  REVIEW_MODES,
  fetchAccuracyHistory,
  fetchAttempts,
  fetchSessions,
  type ReviewFilters,
  type ReviewMode,
} from '@/lib/review/queries';

export const metadata = { title: 'Session Review · Poker Trainer' };

/**
 * Session Review: history, the mistake log, accuracy over time.
 *
 * The last of the six modes to go live, and the first thing in the app to read
 * `drill_attempts` back — every answer since Phase 7 has been recorded with the
 * seed and chart version needed to replay it, and until now nothing did.
 *
 * Filters arrive as search params rather than component state so a filtered
 * view is a URL. `searchParams` is a promise in Next 16.
 */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(params: Record<string, string | string[] | undefined>): ReviewFilters {
  const mode = one(params.mode);
  const grade = one(params.grade);
  const tag = one(params.tag);

  // Narrowed against the known vocabularies rather than cast: these values are
  // attacker-supplied and go into a query.
  return {
    mode: REVIEW_MODES.includes(mode as ReviewMode) ? (mode as ReviewMode) : undefined,
    grade: GRADE_TIERS.includes(grade as GradeTier) ? (grade as GradeTier) : undefined,
    skillTag: tag,
  };
}

async function History() {
  const { points } = await fetchAccuracyHistory();
  return <AccuracyChart points={points} />;
}

async function Log({ filters }: { filters: ReviewFilters }) {
  const [attempts, { chartSet }] = await Promise.all([fetchAttempts(filters), getCharts()]);

  return (
    <MistakeLog
      attempts={attempts}
      currentChartVersion={chartSet.version}
      filtered={Object.values(filters).some((value) => value !== undefined)}
    />
  );
}

async function Sessions({ filters }: { filters: ReviewFilters }) {
  return <SessionList sessions={await fetchSessions(filters)} />;
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);

  return (
    <div className="flex flex-col gap-8">
      <TrackEvent event="review_opened" />

      <header className="flex flex-col gap-1">
        <h1 className="font-display text-lg font-semibold">Session review</h1>
        <p className="text-sm text-ink-muted">
          Every spot you have answered, and the mix it was graded against at the time.
        </p>
      </header>

      <section aria-labelledby="trend-heading" className="flex flex-col gap-3">
        <h2 id="trend-heading" className="text-xs uppercase tracking-wider text-ink-muted">
          Last {DEFAULT_HISTORY_DAYS} days
        </h2>
        {/* Three independent reads, streamed independently: a slow history query
            should not hold up the log, and neither should take the page down. */}
        <Suspense fallback={<Skeleton className="h-44 w-full" />}>
          <History />
        </Suspense>
      </section>

      <Suspense fallback={<Skeleton className="h-8 w-full" />}>
        <FilterBar />
      </Suspense>

      <section aria-labelledby="log-heading" className="flex flex-col gap-3">
        <h2 id="log-heading" className="text-xs uppercase tracking-wider text-ink-muted">
          Answers
        </h2>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <Log filters={filters} />
        </Suspense>
      </section>

      <section aria-labelledby="sessions-heading" className="flex flex-col gap-3">
        <h2 id="sessions-heading" className="text-xs uppercase tracking-wider text-ink-muted">
          Sessions
        </h2>
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          <Sessions filters={filters} />
        </Suspense>
      </section>
    </div>
  );
}
