import type { SkillStat, TrackSummary } from '@poker/engine';
import { WEAK_SPOT_MIN_ATTEMPTS } from '@poker/engine';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/ui/empty-state';
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
function RailSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = `rail-${title.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-xs uppercase tracking-wider text-ink-muted">
        {title}
      </h2>
      {children}
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
    <aside className="flex flex-col gap-8 rounded-[var(--radius)] border border-line bg-surface p-6">
      <RailSection title="Progress">
        {track === undefined ? (
          <EmptyState>The track is not available right now.</EmptyState>
        ) : (
          <div className="flex flex-col gap-2" data-testid="rail-progress">
            <p className="text-sm text-ink">{track.title}</p>

            {/* A count and a bar. The accent is allowed here and in the TODAY
                strip, and nowhere else — docs/05 reserves it for exactly this. */}
            <p className="font-mono text-xs text-ink-muted">
              {track.summary.completed} of {track.summary.total} lessons
            </p>
            <span
              className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
              role="img"
              aria-label={`${track.summary.completed} of ${track.summary.total} lessons complete`}
            >
              <span
                className="block h-full bg-accent"
                style={{
                  width: `${
                    track.summary.total === 0
                      ? 0
                      : (track.summary.completed / track.summary.total) * 100
                  }%`,
                }}
              />
            </span>

            {track.summary.next ? (
              <Link
                href={`/learn/${track.summary.next.slug}`}
                className="text-sm text-ink underline underline-offset-4 hover:text-ink-muted"
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

      <RailSection title="Weak spots">
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
          <ul className="flex flex-col gap-1.5" data-testid="rail-weak-spots">
            {progress.weakSpots.map((spot) => (
              <li key={spot.skillTag}>
                <Link
                  href={`/drill/weak-spots?tag=${encodeURIComponent(spot.skillTag)}`}
                  className="flex items-baseline justify-between gap-2 text-sm text-ink underline underline-offset-4 hover:text-ink-muted"
                  data-tag={spot.skillTag}
                >
                  <span>{progress.labels[spot.skillTag] ?? spot.skillTag}</span>
                  <span className="font-mono text-xs text-ink-muted">
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
          <ul className="flex flex-col gap-1.5" data-testid="rail-recent">
            {progress.recent.map((session) => (
              <li
                key={session.id}
                className="flex items-baseline justify-between gap-2 text-sm text-ink-muted"
              >
                <span className="text-ink">{MODE_LABELS[session.mode] ?? session.mode}</span>
                <span className="font-mono text-xs">
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
