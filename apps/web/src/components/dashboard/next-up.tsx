import type { TrackSummary } from '@poker/engine';
import Link from 'next/link';

/**
 * "Next up" — the Desk's masthead.
 *
 * The goal the dashboard was redesigned around is *"one obvious next action"*.
 * Seven equally-weighted modes is seven next actions, which is none; this sits
 * above them, set as large as anything in the app, and answers the question
 * the reader actually arrived with. It carries the page's one yellow key.
 *
 * It picks up where they stopped rather than recommending: `trackProgress`
 * already resolves the next unlocked lesson, and honouring that is what makes
 * the masthead trustworthy. A masthead that suggested something other than the
 * obvious resumption point would need to explain itself.
 *
 * A finished track still gets a masthead — an empty top of the page reads as a
 * failed load — and its next action is the low-friction drill.
 */

/** Splits a title so its last two words can be set in italic, as the Desk sets statements. */
function statement(title: string): { head: string; tail: string } {
  const words = title.split(' ');
  if (words.length < 3) return { head: '', tail: title };
  return { head: words.slice(0, -2).join(' '), tail: words.slice(-2).join(' ') };
}

export function NextUp({ track }: { track: TrackSummary | undefined }) {
  if (!track) return null;

  if (!track.next) {
    return (
      <section aria-labelledby="next-up-heading" className="flex flex-col" data-testid="next-up">
        <span className="label-caps text-ink-muted">The track · complete</span>
        <h2 id="next-up-heading" className="mt-7 font-display text-7xl tracking-[-0.025em]">
          All ten lessons, <i>done.</i>
        </h2>
        <p className="mt-6 max-w-[34rem] text-lg text-ink-muted">
          The charts are yours now. A quick drill keeps them that way.
        </p>
        <div className="mt-10">
          <Link
            href="/drill/quick"
            className="inline-flex h-13 items-center gap-6 bg-accent pr-4 pl-6 text-base font-semibold text-accent-ink transition-colors hover:bg-accent/90"
          >
            Quick drill
          </Link>
        </div>
      </section>
    );
  }

  const position = track.completed + 1;
  const { head, tail } = statement(track.next.title);

  return (
    <section aria-labelledby="next-up-heading" className="flex flex-col" data-testid="next-up">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* The live item, marked the way a log marks "now". */}
        <span aria-hidden="true" className="size-[7px] rounded-full bg-accent" />
        <span className="label-caps text-ink">Next up</span>
        <span className="label-caps text-ink-muted">
          Lesson {position} of {track.total} · picks up where you stopped
        </span>
      </p>

      <h2
        id="next-up-heading"
        className="mt-7 font-display text-6xl tracking-[-0.025em] 2xl:text-7xl"
      >
        {/* The space before the break is deliberate: a <br> alone can run the
            two lines together in the heading's accessible name. */}
        {head ? (
          <>
            {head} <br />
          </>
        ) : null}
        <i>{tail}</i>
      </h2>

      <p className="mt-6 max-w-[34rem] text-lg text-ink-muted">{track.next.summary}</p>

      <div className="mt-10 flex flex-wrap items-center gap-7">
        <Link
          href={`/learn/${track.next.slug}`}
          className="inline-flex h-13 items-center gap-10 bg-accent pr-5 pl-6 text-base font-semibold text-accent-ink transition-colors hover:bg-accent/90"
        >
          Resume
          {/* No key hint. Phase 16 printed "Space" here on the grounds that the
              drill binds it — but this page does not, and Space does not follow
              a focused link either, so the hint taught a shortcut that did
              nothing. A key is named only where pressing it works. */}
          <span aria-hidden="true">→</span>
        </Link>
        <Link
          href="/drill/quick"
          className="text-base text-ink underline decoration-line underline-offset-[6px] hover:decoration-ink"
        >
          or run a quick drill
        </Link>
      </div>
    </section>
  );
}
