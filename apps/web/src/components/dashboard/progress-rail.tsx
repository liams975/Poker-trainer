import type { SkillStat, TrackSummary } from '@poker/engine';
import { WEAK_SPOT_MIN_ATTEMPTS } from '@poker/engine';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import type { RecentSession } from '@/lib/progress/queries';

/**
 * The right rail: progress, weak spots, recent sessions.
 *
 * docs/05: the progression path lives here — "present and motivating, but not
 * the only door." Every unfilled section is genuinely empty for a new account,
 * and the copy invites the action that would fill it rather than reporting
 * nothing.
 *
 * Phase 8 filled Progress. Phase 9 fills Weak Spots and Recent.
 */
function RailSection({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string | undefined;
  children: ReactNode;
}) {
  const headingId = `rail-${title.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <div className="flex items-baseline justify-between border-b border-line pb-3">
        <h2 id={headingId} className="label-caps text-ink">
          {title}
        </h2>
        {caption ? <span className="label-caps text-ink-muted">{caption}</span> : null}
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}

/** How a mode reads to somebody looking at their own history. */
const MODE_LABELS: Readonly<Record<string, string>> = {
  quick: 'Quick drill',
  focused: 'Focused drill',
  weak_spots: 'Weak spots',
  lesson: 'Lesson drill',
  study: 'Study',
  placement: 'Placement',
};

export interface ProgressRailProps {
  /** Absent when the track could not be loaded; the section stays honest about it. */
  track?: { title: string; summary: TrackSummary } | undefined;
  /** Absent when progress could not be read at all. */
  progress?:
    | {
        weakSpots: readonly SkillStat[];
        recent: readonly RecentSession[];
        /** `skillTag` -> words, resolved from the charts that teach it. */
        labels: Readonly<Record<string, string>>;
      }
    | undefined;
}

export function ProgressRail({ track, progress }: ProgressRailProps) {
  return (
    <aside className="flex flex-col gap-11">
      <RailSection
        title="Progress"
        caption={track ? `${track.summary.completed} of ${track.summary.total}` : undefined}
      >
        {track === undefined ? (
          <EmptyState>The track is not available right now.</EmptyState>
        ) : (
          <div className="flex flex-col gap-4" data-testid="rail-progress">
            <p className="font-display text-2xl">{track.title}</p>

            {/* One mark per lesson: done ones filled, the next one outlined. The
                accent is the game layer's — progress — and the count is
                written beside it, so the marks are never the only encoding. */}
            <span
              className="flex gap-[3px]"
              role="img"
              aria-label={`${track.summary.completed} of ${track.summary.total} lessons complete`}
            >
              {Array.from({ length: track.summary.total }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    'h-2.5 flex-1',
                    index < track.summary.completed ? 'bg-accent' : 'bg-line-soft',
                    index === track.summary.completed &&
                      track.summary.next &&
                      'outline outline-1 -outline-offset-1 outline-accent',
                  )}
                />
              ))}
            </span>

            <p className="font-mono text-xs text-ink-muted">
              {track.summary.completed} of {track.summary.total} lessons
            </p>

            {track.summary.next ? (
              <Link
                href={`/learn/${track.summary.next.slug}`}
                className="text-base text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
              >
                {track.summary.completed === 0 ? 'Start' : 'Continue'}:{' '}
                {track.summary.next.title}
              </Link>
            ) : (
              <p className="text-sm text-ink-muted">Track complete.</p>
            )}
          </div>
        )}
      </RailSection>

      <RailSection title="Weak spots" caption="recent accuracy">
        {progress === undefined ? (
          <EmptyState>Your stats are not available right now.</EmptyState>
        ) : progress.weakSpots.length === 0 ? (
          /* The number comes from the constant the detector actually uses. It
             said "drill 20 hands and check back" before, which was a number
             somebody typed — and twenty mixed hands spread across ten tags
             produce no weak spot at all, so the invitation was a false one. */
          <EmptyState>
            No weak spots yet — {WEAK_SPOT_MIN_ATTEMPTS} answers on a skill before it can
            be judged.
          </EmptyState>
        ) : (
          <ul className="flex flex-col" data-testid="rail-weak-spots">
            {progress.weakSpots.map((spot) => (
              <li key={spot.skillTag}>
                <Link
                  href={`/drill/weak-spots?tag=${encodeURIComponent(spot.skillTag)}`}
                  className="flex items-baseline gap-3 py-2 text-base text-ink hover:text-ink-muted"
                  data-tag={spot.skillTag}
                >
                  <span className="underline decoration-line underline-offset-4">
                    {progress.labels[spot.skillTag] ?? spot.skillTag}
                  </span>
                  <span className="leader" aria-hidden="true" />
                  <span className="font-mono text-sm text-ink">
                    {Math.round(spot.ewmaAccuracy * 100)}%
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </RailSection>

      <RailSection title="Recent">
        {progress === undefined ? (
          <EmptyState>Your history is not available right now.</EmptyState>
        ) : progress.recent.length === 0 ? (
          <EmptyState>No sessions yet. Your last five will show up here.</EmptyState>
        ) : (
          <ul className="flex flex-col" data-testid="rail-recent">
            {progress.recent.map((session) => (
              <li
                key={session.id}
                className="flex items-baseline justify-between gap-2 border-b border-line-soft py-2.5 text-ink-muted"
              >
                <span className="text-base text-ink">{MODE_LABELS[session.mode] ?? session.mode}</span>
                <span className="font-mono text-sm">
                  {session.spots} {session.spots === 1 ? 'spot' : 'spots'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </RailSection>
    </aside>
  );
}
