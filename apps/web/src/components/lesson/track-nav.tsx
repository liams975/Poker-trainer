import type { LessonStatus, Track } from '@poker/engine';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * The track, module by module.
 *
 * Locked lessons are shown rather than hidden. Seeing what is ahead is most of
 * why a course feels like one, and a hidden lesson reads as missing rather than
 * as not yet reached — but they are rendered as plain text, not links, so the
 * ordering is visible without being clickable.
 *
 * Monochrome throughout: docs/05 keeps saturated colour for strategy data, and
 * this sits alongside pages full of range grids.
 */
const STATUS_LABEL: Readonly<Record<LessonStatus, string>> = {
  locked: 'Locked',
  available: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

const STATUS_GLYPH: Readonly<Record<LessonStatus, string>> = {
  locked: '·',
  available: '○',
  in_progress: '◐',
  completed: '●',
};

export interface TrackNavProps {
  track: Track;
  states: ReadonlyMap<string, LessonStatus>;
  /** Highlighted as the current page, when one is open. */
  activeSlug?: string | undefined;
}

export function TrackNav({ track, states, activeSlug }: TrackNavProps) {
  const modules = [...track.modules].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <nav className="flex flex-col gap-6" aria-label="Track contents">
      {modules.map((module) => (
        <section key={module.slug} className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-wider text-ink-muted">{module.title}</h2>

          <ol className="flex flex-col gap-0.5">
            {[...module.lessons]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((lesson) => {
                const status = states.get(lesson.slug) ?? 'locked';
                const active = lesson.slug === activeSlug;

                const inner = (
                  <>
                    {/* Glyph and text, never colour alone — the status has to
                        survive greyscale and a screen reader. */}
                    <span aria-hidden="true" className="w-4 shrink-0 text-ink-muted">
                      {STATUS_GLYPH[status]}
                    </span>
                    <span className="flex-1">{lesson.title}</span>
                    <span className="sr-only">{STATUS_LABEL[status]}</span>
                  </>
                );

                const shared = cn(
                  'flex items-baseline gap-2 rounded-[var(--radius)] px-2 py-1.5 text-sm',
                  active && 'bg-surface-raised font-semibold text-ink',
                );

                return (
                  <li key={lesson.slug} data-status={status}>
                    {status === 'locked' ? (
                      <span className={cn(shared, 'text-ink-muted opacity-60')} data-locked="true">
                        {inner}
                      </span>
                    ) : (
                      <Link
                        href={`/learn/${lesson.slug}`}
                        aria-current={active ? 'page' : undefined}
                        className={cn(shared, 'text-ink hover:bg-surface-raised')}
                      >
                        {inner}
                      </Link>
                    )}
                  </li>
                );
              })}
          </ol>
        </section>
      ))}
    </nav>
  );
}
