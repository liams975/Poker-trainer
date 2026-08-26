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
}

const LENGTHS: readonly (number | null)[] = [10, 25, 50, null];

function lengthLabel(length: number | null): string {
  return length === null ? 'Endless' : `${length} spots`;
}

/** Shared chip styling — active state is border and weight, never hue. */
function chipClass(active: boolean): string {
  return cn(
    'rounded-[var(--radius)] border px-3 py-1.5 text-sm transition-colors',
    active
      ? 'border-ink bg-surface-raised text-ink'
      : 'border-line bg-surface text-ink-muted hover:border-ink-muted hover:text-ink',
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
    <div className="flex flex-col gap-6 rounded-[var(--radius)] border border-line bg-surface p-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="font-display text-xs font-semibold text-ink">Mode</legend>
        {/* docs/05's Study/Drill toggle is a pedagogy switch, not a difficulty
            setting, so the description says what actually changes. */}
        <div className="flex flex-wrap gap-2">
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
        <p className="text-xs text-ink-muted">
          {studyMode
            ? 'The chart is on screen before you answer, the reasoning is shown in full, and nothing counts towards your stats.'
            : 'The chart stays hidden until you answer. Attempts are recorded.'}
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-display text-xs font-semibold text-ink">Length</legend>
        <div className="flex flex-wrap gap-2">
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
        <fieldset className="flex flex-col gap-2">
          <legend className="font-display text-xs font-semibold text-ink">Timer</legend>
          <div className="flex flex-wrap gap-2">
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
          <p className="text-xs text-ink-muted">
            Counts up, and never cuts you off — response time is recorded either way.
          </p>
        </fieldset>
      )}

      {allowFilters ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-display text-xs font-semibold text-ink">Spots</legend>
          <div className="flex flex-wrap gap-2">
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
            <p className="text-xs text-ink-muted">Pick at least one to drill.</p>
          ) : null}
        </fieldset>
      ) : null}

      <div>
        <Button
          type="button"
          disabled={!canStart}
          onClick={() =>
            onStart({ studyMode, length, timed: studyMode ? false : timed, templateSlugs: chosen })
          }
        >
          {busy ? 'Starting…' : 'Start'}
        </Button>
      </div>
    </div>
  );
}
