import { GRADE_TIERS, type GradeTier } from '@poker/engine';
import { Suspense } from 'react';

import { TrackEvent } from '@/components/analytics/track-event';
import { EvLossChart } from '@/components/review/ev-loss-chart';
import { TagCosts } from '@/components/review/tag-costs';
import { FilterBar } from '@/components/review/filter-bar';
import { MistakeLog } from '@/components/review/mistake-log';
import { SessionList } from '@/components/review/session-list';
import { SectionHead } from '@/components/ui/section-head';
import { Skeleton } from '@/components/ui/skeleton';
import { getCharts } from '@/lib/charts/registry';
import {
  DEFAULT_HISTORY_DAYS,
  REVIEW_MODES,
  fetchReviewHistory,
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
  // One read feeds both: the trend and the per-skill cost are two readings of
  // the same window, and fetching them separately is how a chart and a table
  // beneath it end up describing different fortnights.
  const [{ points, byTag }, { registry }] = await Promise.all([
    fetchReviewHistory(),
    getCharts(),
  ]);

  return (
    <div className="flex flex-col gap-14">
      <EvLossChart
        points={points}
        caption={{
          figure: 'Fig. 1',
          text: 'bb lost per spot, one dot a day, the seven-day mean behind it. Zero is at the top. Hatched columns are days with no practice — a gap, never a zero.',
        }}
      />
      <TagCosts costs={byTag} registry={registry} />
    </div>
  );
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
    <div className="flex flex-col gap-20">
      <TrackEvent event="review_opened" />

      <header className="flex flex-col gap-6">
        <h1 className="font-display text-6xl tracking-[-0.02em]">
          Session <i>review</i>
        </h1>
        <p className="max-w-[40rem] text-lg text-ink-muted">
          Every spot you have answered, and the mix it was graded against at the time.
        </p>
      </header>

      <section aria-labelledby="trend-heading" className="flex flex-col gap-8">
        <SectionHead
          n={1}
          id="trend-heading"
          title="The record"
          caption={`last ${DEFAULT_HISTORY_DAYS} days`}
        />
        {/* Three independent reads, streamed independently: a slow history query
            should not hold up the log, and neither should take the page down. */}
        <Suspense fallback={<Skeleton className="h-44 w-full" />}>
          <History />
        </Suspense>
      </section>

      <section aria-labelledby="log-heading" className="flex flex-col gap-6">
        <SectionHead n={2} id="log-heading" title="Answers" caption="replayed from the stored spot" />
        <Suspense fallback={<Skeleton className="h-8 w-full" />}>
          <FilterBar />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <Log filters={filters} />
        </Suspense>
      </section>

      <section aria-labelledby="sessions-heading" className="flex flex-col gap-6">
        <SectionHead n={3} id="sessions-heading" title="Sessions" />
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          <Sessions filters={filters} />
        </Suspense>
      </section>
    </div>
  );
}
