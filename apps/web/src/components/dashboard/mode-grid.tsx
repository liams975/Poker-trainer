import Link from 'next/link';

import { cn } from '@/lib/utils';

import { MODES } from './modes';

/**
 * The seven ways in, set as a book's table of contents.
 *
 * Phase 16 drew them as seven equal cards, which read as a SaaS feature grid
 * and gave every mode the same weight as the one obvious next action above it.
 * A contents list is how a book offers choice without shouting: a number, a
 * title, a dot leader, a figure where the page number would be, and one line
 * under it saying what is there.
 *
 * An unavailable mode renders as a non-interactive row, not a disabled link: a
 * disabled anchor is still focusable in some browsers and still announced as a
 * link, which sends a keyboard user somewhere that does not exist. The phase
 * label is real text, so the state does not depend on the dimmed styling.
 *
 * Titles keep their capitals ("Range Explorer"): the e2e suite finds these
 * links by name, case-sensitively.
 */
export function ModeGrid({
  figures = {},
}: {
  /** Live figures by slug, where the Desk has one — they replace the static text. */
  figures?: Readonly<Record<string, string>>;
}) {
  return (
    <ol className="flex flex-col">
      {MODES.map((mode, index) => {
        const available = mode.availableIn === null;

        const row = (
          <span
            className={cn(
              'grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-baseline gap-y-2 border-b border-line py-5',
              available && 'transition-colors group-hover:bg-surface',
            )}
          >
            <span className="font-mono text-sm text-ink-muted">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="flex items-baseline gap-4">
              <span className="whitespace-nowrap font-display text-3xl">{mode.title}</span>
              <span className="leader" aria-hidden="true" />
            </span>
            <span className="pl-4 pr-2 font-mono text-sm text-ink">
              {available ? (figures[mode.slug] ?? mode.figure) : `Phase ${mode.availableIn}`}
            </span>
            <span className="col-start-2 col-end-4 text-base text-ink-muted">
              {mode.description}
            </span>
          </span>
        );

        return (
          <li key={mode.slug}>
            {available ? (
              <Link href={mode.href} className="group block">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ol>
  );
}
