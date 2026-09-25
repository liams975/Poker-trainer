'use client';

import type {
  ChartSet,
  DrillTemplate,
  Lesson,
  LessonStatus,
  RangeChart,
  Track,
} from '@poker/engine';
import { createChartRegistry, lookupChart, orderedLessons } from '@poker/engine';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
// Aliased: `track` is already the curriculum Track in this file, and a
// silent shadow there would be a confusing bug rather than a compile error.
import { track as trackEvent } from '@/lib/analytics/client';
import { setLessonStatus } from '@/lib/lessons/client';

import { LessonBlockView } from './blocks';

/**
 * One lesson, read top to bottom.
 *
 * Completion is a deliberate act rather than a scroll heuristic: "I have read
 * this" is a claim only the reader can make, and inferring it from scroll
 * position means the next lesson unlocks itself while someone is skimming for
 * a chart.
 *
 * The server still checks that the lesson was unlocked before recording it —
 * see lib/lessons/record.ts. The button being on screen is not the
 * authorisation.
 */
export interface LessonViewProps {
  track: Track;
  lesson: Lesson;
  status: LessonStatus;
  chartSet: ChartSet;
  templates: readonly { id: string; template: DrillTemplate }[];
  nextLessonSlug: string | null;
}

/** "2.2" for the second lesson of the second module, by the track's own order. */
function sectionOf(track: Track, slug: string): { number: string; module: string } | null {
  const modules = [...track.modules].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const [m, module] of modules.entries()) {
    const lessons = [...module.lessons].sort((a, b) => a.sortOrder - b.sortOrder);
    const l = lessons.findIndex((entry) => entry.slug === slug);
    if (l !== -1) return { number: `${m + 1}.${l + 1}`, module: module.title };
  }
  return null;
}

export function LessonView({
  track,
  lesson,
  status,
  chartSet,
  templates,
  nextLessonSlug,
}: LessonViewProps) {
  const registry = useMemo(() => createChartRegistry(chartSet), [chartSet]);
  const [completed, setCompleted] = useState(status === 'completed');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chartFor = useMemo(
    () =>
      (heroPosition: string, actionSequence: string): RangeChart | undefined =>
        lookupChart(registry, {
          tableSize: 6,
          stackDepth: 100,
          heroPosition: heroPosition as never,
          actionSequence,
        }),
    [registry],
  );

  const position = orderedLessons(track).findIndex((l) => l.slug === lesson.slug) + 1;
  const total = orderedLessons(track).length;

  /**
   * The lesson's section number, as a textbook numbers one: module, then the
   * lesson within it — "§2.2". Derived from the track's own ordering, so it
   * cannot disagree with the contents list beside it.
   */
  const section = sectionOf(track, lesson.slug);

  /**
   * Per-block furniture: the first paragraph opens with a drop cap, each range
   * figure is lettered in order ("Fig. 2.2a", "2.2b"), and the drill that
   * closes the lesson is its exercise. Each letter is counted from the blocks
   * before it rather than by a running counter, which would be a mutation
   * escaping the render — the same thing `nearestCharts` below avoids.
   */
  const firstProse = lesson.blocks.findIndex((block) => block.kind === 'prose');
  const furniture = lesson.blocks.map((block, index) => {
    if (block.kind === 'range') {
      const before = lesson.blocks.slice(0, index).filter((b) => b.kind === 'range').length;
      return {
        figure: section ? `Fig. ${section.number}${String.fromCharCode(97 + before)}` : undefined,
      };
    }
    if (block.kind === 'drill') {
      return { exercise: section ? `Exercise ${section.number}` : undefined };
    }
    return { lead: index === firstProse };
  });

  /** The last two words of the title in italic, the way statements are set. */
  const words = lesson.title.split(' ');
  const titleHead = words.length > 2 ? words.slice(0, -2).join(' ') : '';
  const titleTail = words.length > 2 ? words.slice(-2).join(' ') : lesson.title;

  async function complete(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await setLessonStatus(lesson.slug, 'completed');
      setCompleted(true);
      // After the write, never before: a funnel step that counts intent rather
      // than outcome would show a completion rate the database disagrees with.
      trackEvent('lesson_completed', { lesson: lesson.slug });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'could not save your progress');
    } finally {
      setSaving(false);
    }
  }

  /**
   * For each block, the chart most recently shown above it — so a `hands` block
   * reads its numbers from the range the reader is looking at rather than from
   * an unrelated one. Derived up front rather than tracked with a variable
   * during the map, which would be a mutation escaping the render.
   */
  const nearestCharts = useMemo(
    () =>
      lesson.blocks.map((_, index) => {
        // Scanning backwards keeps the cursor local to this callback. Carrying
        // it forward in an outer variable would be a mutation that outlives the
        // render, which is what `react-hooks/immutability` is there to catch.
        for (let i = index; i >= 0; i -= 1) {
          const block = lesson.blocks[i];
          if (block?.kind === 'range') {
            return chartFor(block.heroPosition, block.actionSequence);
          }
        }
        return undefined;
      }),
    [lesson.blocks, chartFor],
  );

  return (
    <article className="flex flex-col">
      <header className="flex flex-col border-b border-line pb-12">
        <p className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          {section ? <span className="label-caps text-ink">§{section.number}</span> : null}
          <span className="label-caps text-ink-muted">
            {section ? `${section.module} · ` : ''}lesson {position} of {total}
          </span>
        </p>
        <h1 className="mt-7 font-display text-6xl tracking-[-0.02em]">
          {titleHead ? `${titleHead} ` : null}
          <i>{titleTail}</i>
        </h1>
        <p className="mt-6 max-w-[40rem] text-xl text-ink-muted">{lesson.summary}</p>
      </header>

      {/* Block layout, not flex: the margin notes float into the right-hand
          padding, and a flex item cannot float. `flow-root` contains them. */}
      <div className="relative flow-root space-y-10 pt-12 xl:pr-[19rem]">
        {lesson.blocks.map((block, index) => (
          <LessonBlockView
            key={`${block.kind}-${index}`}
            block={block}
            chartFor={chartFor}
            nearestChart={nearestCharts[index]}
            registry={registry}
            drill={{ chartSet, templates }}
            {...furniture[index]}
          />
        ))}
      </div>

      <footer className="mt-14 flex flex-wrap items-center gap-6 border-t border-line pt-8 xl:mr-[19rem]">
        {completed ? (
          <>
            <p className="label-caps text-ink" data-testid="lesson-completed">
              Completed.
            </p>
            {nextLessonSlug ? (
              <Button asChild>
                <Link href={`/learn/${nextLessonSlug}`}>Next lesson →</Link>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href="/learn">Back to the track</Link>
              </Button>
            )}
          </>
        ) : (
          // The page's yellow key: the one act only the reader can perform.
          <Button
            type="button"
            className="h-13 px-6"
            onClick={() => void complete()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Mark as complete'}
          </Button>
        )}

        {error ? <p className="font-mono text-sm text-ink">{error}</p> : null}
      </footer>
    </article>
  );
}
