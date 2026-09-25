import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, lookupChart } from '@poker/engine';
import { loadChartRegistry } from '@poker/content';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Wordmark } from '@/components/brand/wordmark';
import { HeroGrid } from '@/components/landing/hero-grid';
import { RankLadder } from '@/components/mastery/rank-ladder';
import { chartLabel } from '@/lib/charts/map';
import { getCurrentUser } from '@/lib/auth/dal';

export const metadata = {
  title: 'Poker Trainer — learn 6-max preflop properly',
  description:
    'Range charts, graded drills and a course for 6-max cash. Grades the mix, not a single right answer.',
};

/**
 * The landing page. One argument, shown working, with the climb visible —
 * set as the opening pages of a short book: a statement, a figure, three
 * numbered sections.
 *
 * Also the router for everyone who already has an account. `isPublicPath`
 * treats `/` as public so the proxy lets it through and this decides — signed
 * in goes to the dashboard, signed out gets the page below.
 *
 * **The chart comes from the bundled `@poker/content`, not the database.** This
 * is the one place in the app where that is right rather than a bug: every
 * other reader goes through Supabase so `pnpm content:sync` means something,
 * but RLS correctly refuses an anonymous visitor any `range_charts` row at all,
 * and a landing page that 500s for logged-out visitors is not a landing page.
 * The chart is illustrative here; nothing is graded against it.
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  const registry = loadChartRegistry();
  const chart = lookupChart(registry, {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition: 'BTN',
    actionSequence: 'rfi',
  });

  return (
    <div className="mx-auto w-full max-w-[1440px] px-8 sm:px-14">
      <header className="flex h-16 items-center justify-between border-b border-line">
        <Link href="/" className="flex items-center">
          <Wordmark />
        </Link>

        <nav aria-label="Landing" className="flex items-center gap-7">
          <a href="#grades" className="label-caps text-ink-muted transition-colors hover:text-ink">
            How it grades
          </a>
          <a href="#course" className="label-caps text-ink-muted transition-colors hover:text-ink">
            The course
          </a>
          <Link
            href="/sign-in"
            className="inline-flex h-9 items-center border border-line px-4 text-sm text-ink transition-colors hover:border-ink"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <section className="grid grid-cols-1 gap-x-16 gap-y-12 pt-20 pb-24 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex flex-col">
          <span className="label-caps text-ink-muted">6-max cash · 100bb · preflop</span>

          <h1 className="mt-8 font-display text-6xl tracking-[-0.02em]">
            A range is a <i>frequency.</i> Train it like one.
          </h1>

          <p className="mt-8 max-w-[34rem] text-lg text-ink-muted">
            <span className="font-mono text-ink">A5o</span> opens exactly half the time on the
            button. Most trainers call that a raise and mark you wrong for folding. This one grades
            the mix on four tiers, scores you by EV lost, and tracks which of ten skills is actually
            leaking.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-6">
            {/* The yellow key: the one thing on this page to press. */}
            <Link
              href="/sign-up"
              className="inline-flex h-13 items-center gap-5 bg-accent px-6 text-base font-semibold text-accent-ink transition-colors hover:bg-accent/90"
            >
              Start free — 24-spot placement
            </Link>
            <span className="text-sm text-ink-muted">No card. Desktop, keyboard-first.</span>
          </div>
        </div>

        {chart ? (
          <div id="grades" className="scroll-mt-8">
            <HeroGrid chart={chart} label={chartLabel(chart)} />
          </div>
        ) : null}
      </section>

      <section
        id="course"
        aria-labelledby="what-heading"
        className="scroll-mt-8 border-t border-line pt-6 pb-24"
      >
        <div className="flex items-baseline gap-5">
          <span className="font-mono text-sm text-ink-muted">§1</span>
          <h2 id="what-heading" className="font-display text-4xl">
            Three things it <i>does</i>
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-12 md:grid-cols-3">
          {[
            {
              title: 'A short course',
              body: 'Ten lessons on position, blind defence and reading a range, each ending in drills on what it just taught. A placement test skips you past what you already know.',
            },
            {
              title: 'Graded drills',
              body: 'Spots dealt from real charts, answered by keyboard, graded on four tiers rather than right and wrong — and scored by EV lost, so a marginal frequency error does not cost what a blunder costs.',
            },
            {
              title: 'Your weak spots',
              body: 'Every answer is recorded. The app works out which spots you are least sharp on from recent performance, and can drill only those.',
            },
          ].map((card, index) => (
            <div key={card.title} className="flex flex-col gap-4 border-t-2 border-ink pt-5">
              <span className="font-display text-2xl italic text-ink-muted">{index + 1}</span>
              <h3 className="font-display text-3xl">{card.title}</h3>
              <p className="text-base text-ink-muted">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line pt-6 pb-24">
        {/*
          The same ladder `/mastery` renders, with no reader to place on it.
          One component rather than a lookalike: a climb the landing page drew
          differently from the real one would be a promise the product does not
          keep.
        */}
        <RankLadder
          rank={undefined}
          n={2}
          heading="The climb"
          headingClassName="font-display text-4xl"
          caption="Ranks come from EV lost per spot across your last 200 answers — not from time served. They move down as well as up."
        />
      </section>

      <section className="grid grid-cols-1 gap-10 border-t border-line pt-6 pb-24 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex items-baseline gap-5">
          <span className="font-mono text-sm text-ink-muted">§3</span>
          <h2 className="font-display text-4xl">
            What it is <i>not</i>
          </h2>
        </div>
        <p className="max-w-[40rem] text-lg text-ink-muted">
          Not a solver. Strategy comes from preflop charts and postflop heuristics, and the app
          covers 6-max cash at 100bb — no tournaments, no ICM, no postflop tree. It runs on a
          laptop, not a phone. If you want a solver, buy a solver.
        </p>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line py-8">
        <span className="label-caps text-ink-muted">Poker Trainer · 6-max cash · 100bb</span>
        <div className="flex gap-6">
          <Link href="/privacy" className="label-caps text-ink-muted hover:text-ink">
            Privacy
          </Link>
          <Link href="/sign-in" className="label-caps text-ink-muted hover:text-ink">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
