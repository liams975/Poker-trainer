import type { TrackSummary } from '@poker/engine';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/ui/empty-state';

/**
 * The right rail: progress, weak spots, recent sessions.
 *
 * docs/05: the progression path lives here — "present and motivating, but not
 * the only door." Every unfilled section is genuinely empty for a new account,
 * and the copy invites the action that would fill it rather than reporting
 * nothing.
 *
 * Phase 8 fills Progress. Phase 9 fills Weak Spots and Recent.
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

export interface ProgressRailProps {
  /** Absent when the track could not be loaded; the section stays honest about it. */
  track?: { title: string; summary: TrackSummary } | undefined;
}

export function ProgressRail({ track }: ProgressRailProps) {
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
        <EmptyState>No weak spots yet — drill 20 hands and check back.</EmptyState>
      </RailSection>

      <RailSection title="Recent">
        <EmptyState>No sessions yet. Your last five will show up here.</EmptyState>
      </RailSection>
    </aside>
  );
}
