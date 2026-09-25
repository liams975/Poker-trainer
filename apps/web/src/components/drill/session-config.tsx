'use client';

import type { DrillTemplate } from '@poker/engine';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Session setup.
 *
 * Monochrome throughout, like the chart selector: docs/05 reserves saturated
 * colour for strategy data, and this screen sits one click from a range grid
 * where hue carries meaning.
 */
export interface SessionConfig {
  studyMode: boolean;
  /** Spots to run. `null` is endless — the user stops when they want to. */
  length: number | null;
  /** Drill Mode only, and elapsed rather than a countdown. See docs/05. */
  timed: boolean;
  templateSlugs: readonly string[];
  /**
   * Restricts the draw to spots exercising these skill tags. Weak-spot drilling
   * only, and never set from this form — a template is a family covering
   * several tags, so picking templates cannot target one of them.
   */
  focusTags?: readonly string[];
}

const LENGTHS: readonly (number | null)[] = [10, 25, 50, null];

function lengthLabel(length: number | null): string {
  return length === null ? 'Endless' : `${length} spots`;
}

/**
 * Shared option styling — active state is an inverted key, never a hue. The
 * options are keys on the same keypad as the answers: square, and pressed
 * when chosen.
 */
function chipClass(active: boolean): string {
  return cn(
    'h-11 border px-4 text-base transition-colors',
    active
      ? 'border-ink bg-ink text-canvas'
      : 'border-line bg-surface-raised text-ink hover:border-ink',
  );
}

export interface SessionConfigProps {
  templates: readonly DrillTemplate[];
  /** Focused drill picks templates; quick drill uses them all. */
  allowFilters: boolean;
  onStart: (config: SessionConfig) => void;
  busy?: boolean;
}

export function SessionConfigForm({
  templates,
  allowFilters,
  onStart,
  busy = false,
}: SessionConfigProps) {
  const [studyMode, setStudyMode] = useState(false);
  const [length, setLength] = useState<number | null>(25);
  const [timed, setTimed] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>(() =>
    templates.map((template) => template.slug),
  );

  const chosen = allowFilters ? selected : templates.map((t) => t.slug);
  const canStart = chosen.length > 0 && !busy;

  function toggle(slug: string): void {
    setSelected((current) =>
      current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
    );
  }

  return (
    <div className="flex max-w-[52rem] flex-col border-t-2 border-ink">
      <fieldset className="grid grid-cols-1 gap-x-10 gap-y-3 border-b border-line py-7 md:grid-cols-[10rem_minmax(0,1fr)]">
        <legend className="label-caps float-left pt-3 text-ink">Mode</legend>
        {/* docs/05's Study/Drill toggle is a pedagogy switch, not a difficulty
            setting, so the description says what actually changes. */}
        <div className="flex flex-wrap gap-1.5 md:col-start-2">
          <button
            type="button"
            aria-pressed={!studyMode}
            onClick={() => setStudyMode(false)}
            className={chipClass(!studyMode)}
          >
            Drill
          </button>
          <button
            type="button"
            aria-pressed={studyMode}
            onClick={() => setStudyMode(true)}
            className={chipClass(studyMode)}
          >
            Study
          </button>
        </div>
        <p className="text-sm text-ink-muted md:col-start-2">
          {studyMode
            ? 'The chart is on screen before you answer, the reasoning is shown in full, and nothing counts towards your stats.'
            : 'The chart stays hidden until you answer. Attempts are recorded.'}
        </p>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-x-10 gap-y-3 border-b border-line py-7 md:grid-cols-[10rem_minmax(0,1fr)]">
        <legend className="label-caps float-left pt-3 text-ink">Length</legend>
        <div className="flex flex-wrap gap-1.5 md:col-start-2">
          {LENGTHS.map((option) => (
            <button
              key={String(option)}
              type="button"
              aria-pressed={length === option}
              onClick={() => setLength(option)}
              className={chipClass(length === option)}
            >
              {lengthLabel(option)}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Study Mode is untimed by definition (docs/05), so the control only
          exists where it can mean something. */}
      {studyMode ? null : (
        <fieldset className="grid grid-cols-1 gap-x-10 gap-y-3 border-b border-line py-7 md:grid-cols-[10rem_minmax(0,1fr)]">
          <legend className="label-caps float-left pt-3 text-ink">Timer</legend>
          <div className="flex flex-wrap gap-1.5 md:col-start-2">
            <button
              type="button"
              aria-pressed={!timed}
              onClick={() => setTimed(false)}
              className={chipClass(!timed)}
            >
              Off
            </button>
            <button
              type="button"
              aria-pressed={timed}
              onClick={() => setTimed(true)}
              className={chipClass(timed)}
            >
              Show elapsed
            </button>
          </div>
          <p className="text-sm text-ink-muted md:col-start-2">
            Counts up, and never cuts you off — response time is recorded either way.
          </p>
        </fieldset>
      )}

      {allowFilters ? (
        <fieldset className="grid grid-cols-1 gap-x-10 gap-y-3 border-b border-line py-7 md:grid-cols-[10rem_minmax(0,1fr)]">
          <legend className="label-caps float-left pt-3 text-ink">Spots</legend>
          <div className="flex flex-wrap gap-1.5 md:col-start-2">
            {templates.map((template) => (
              <button
                key={template.slug}
                type="button"
                aria-pressed={selected.includes(template.slug)}
                onClick={() => toggle(template.slug)}
                className={chipClass(selected.includes(template.slug))}
              >
                {template.title}
              </button>
            ))}
          </div>
          {selected.length === 0 ? (
            <p className="text-sm text-ink-muted md:col-start-2">Pick at least one to drill.</p>
          ) : null}
        </fieldset>
      ) : null}

      <div className="pt-8">
        {/* The screen's yellow key. */}
        <Button
          type="button"
          className="h-13 w-60 justify-between px-5"
          disabled={!canStart}
          onClick={() =>
            onStart({ studyMode, length, timed: studyMode ? false : timed, templateSlugs: chosen })
          }
        >
          <span>{busy ? 'Starting…' : 'Start'}</span>
          <span aria-hidden="true">→</span>
        </Button>
      </div>
    </div>
  );
}
