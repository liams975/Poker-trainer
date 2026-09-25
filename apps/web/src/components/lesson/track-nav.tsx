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
  /** `columns` sets the modules side by side, for the course's own contents page. */
  layout?: 'column' | 'columns';
}

export function TrackNav({ track, states, activeSlug, layout = 'column' }: TrackNavProps) {
  const modules = [...track.modules].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <nav
      className={cn(
        layout === 'columns' ? 'grid grid-cols-1 gap-12 lg:grid-cols-3' : 'flex flex-col gap-8',
      )}
      aria-label="Track contents"
    >
      {modules.map((module, moduleIndex) => (
        <section key={module.slug} className="flex flex-col gap-2">
          {/* Numbered as a textbook's contents: §1, then 1.1, 1.2 — the same
              numbers the lesson page and its figures carry. */}
          <h2 className="flex items-baseline gap-2.5 pb-1 text-sm font-semibold text-ink">
            <span className="font-mono text-xs font-normal text-ink-muted">§{moduleIndex + 1}</span>
            {module.title}
          </h2>

          <ol className="flex flex-col">
            {[...module.lessons]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((lesson, lessonIndex) => {
                const status = states.get(lesson.slug) ?? 'locked';
                const active = lesson.slug === activeSlug;

                const inner = (
                  <>
                    {/* Glyph and text, never colour alone — the status has to
                        survive greyscale and a screen reader. */}
                    <span
                      aria-hidden="true"
                      className="w-8 shrink-0 font-mono text-xs text-ink-muted"
                    >
                      {moduleIndex + 1}.{lessonIndex + 1}
                    </span>
                    <span className="flex-1">{lesson.title}</span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'w-3 shrink-0 text-right text-xs',
                        active ? 'text-accent' : 'text-ink-muted',
                      )}
                    >
                      {STATUS_GLYPH[status]}
                    </span>
                    <span className="sr-only">{STATUS_LABEL[status]}</span>
                  </>
                );

                const shared = cn(
                  'flex items-baseline gap-2 py-2 pr-2.5 pl-2.5 text-base leading-snug',
                  // The open lesson: a raised row with an accent edge. The
                  // accent marks progress — where you are in the course.
                  active && 'bg-surface-raised text-ink shadow-[inset_2px_0_0_var(--color-accent)]',
                );

                return (
                  <li key={lesson.slug} data-status={status}>
                    {status === 'locked' ? (
                      // `text-ink-muted` alone, without the opacity that used to
                      // be stacked on it: muted text at 60% opacity falls under
                      // the 4.5:1 contrast floor, and the lock glyph beside it
                      // already carries the meaning without needing to be dim.
                      <span className={cn(shared, 'text-ink-muted')} data-locked="true">
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
