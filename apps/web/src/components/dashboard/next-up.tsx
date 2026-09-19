import type { TrackSummary } from '@poker/engine';
import Link from 'next/link';

/**
 * "Next up" — the defining element of frame 2b.
 *
 * The deck's stated goal for the dashboard is *"one obvious next action"*. Six
 * equally-weighted mode cards is six next actions, which is none; this sits
 * above them and answers the question the reader actually arrived with.
 *
 * It picks up where they stopped rather than recommending: `trackProgress`
 * already resolves the next unlocked lesson, and honouring that is what makes
 * the card trustworthy. A card that suggested something other than the obvious
 * resumption point would need to explain itself.
 */
export function NextUp({ track }: { track: TrackSummary | undefined }) {
  // No track read, or the course is finished — either way there is no single
  // obvious action, and inventing one would be worse than the mode grid below.
  if (!track?.next) return null;

  const position = track.completed + 1;

  return (
    <section
      aria-labelledby="next-up-heading"
      className="flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-surface p-5"
      data-testid="next-up"
    >
      <span
        id="next-up-heading"
        className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted"
      >
        Next up · picks up where you stopped
      </span>

      <h2 className="text-lg font-medium">{track.next.title}</h2>

      <p className="font-mono text-xs text-ink-muted">
        Lesson {position} of {track.total}
      </p>

      <p className="max-w-prose text-sm text-ink-muted">{track.next.summary}</p>

      <div className="mt-1 flex items-center gap-3">
        <Link
          href={`/learn/${track.next.slug}`}
          className="inline-flex h-9 items-center rounded-[var(--radius)] border border-accent px-4 text-sm text-accent-hi transition-colors hover:bg-accent/10 active:bg-accent/20"
        >
          Resume
        </Link>
        {/* The shortcut is real — `drill-runner` and the palette both bind it —
            so naming it here teaches rather than decorates. */}
        <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-2xs text-ink-muted">
          Space
        </kbd>
      </div>
    </section>
  );
}
