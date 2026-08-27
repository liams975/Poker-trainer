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

  async function complete(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await setLessonStatus(lesson.slug, 'completed');
      setCompleted(true);
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
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wider text-ink-muted">
          {track.title} · {position} of {total}
        </p>
        <h1 className="font-display text-xl font-semibold">{lesson.title}</h1>
        <p className="max-w-[62ch] text-sm text-ink-muted">{lesson.summary}</p>
      </header>

      <div className="flex flex-col gap-6">
        {lesson.blocks.map((block, index) => (
          <LessonBlockView
            key={`${block.kind}-${index}`}
            block={block}
            chartFor={chartFor}
            nearestChart={nearestCharts[index]}
            drill={{ chartSet, templates }}
          />
        ))}
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
        {completed ? (
          <>
            <p className="text-sm text-ink-muted" data-testid="lesson-completed">
              Completed.
            </p>
            {nextLessonSlug ? (
              <Button asChild size="sm">
                <Link href={`/learn/${nextLessonSlug}`}>Next lesson</Link>
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link href="/learn">Back to the track</Link>
              </Button>
            )}
          </>
        ) : (
          <Button type="button" onClick={() => void complete()} disabled={saving}>
            {saving ? 'Saving…' : 'Mark as complete'}
          </Button>
        )}

        {error ? <p className="text-sm text-ink">{error}</p> : null}
      </footer>
    </article>
  );
}
