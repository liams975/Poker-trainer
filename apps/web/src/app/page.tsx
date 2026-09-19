import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, lookupChart } from '@poker/engine';
import { loadChartRegistry } from '@poker/content';
import Link from 'next/link';
import { redirect } from 'next/navigation';

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
 * The landing page — frame 2a. One argument, shown working, with the climb
 * visible.
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
    <div className="mx-auto w-full max-w-[1180px]">
      {/* 60px bar with a hairline under it, per the frame. */}
      <header className="flex h-[60px] items-center justify-between border-b border-line px-10">
        <span className="text-base font-semibold tracking-tight">Poker Trainer</span>

        <nav aria-label="Landing" className="flex items-center gap-5 text-sm">
          <a href="#grades" className="text-ink-muted transition-colors hover:text-ink">
            How it grades
          </a>
          <a href="#course" className="text-ink-muted transition-colors hover:text-ink">
            The course
          </a>
          {/* Outlined, never filled. Nocturne: "primary actions are accent
              outlines", and the deck follows it on every screen. */}
          <Link
            href="/sign-in"
            className="inline-flex h-8 items-center rounded-[var(--radius)] border border-accent px-3.5 text-accent-hi transition-colors hover:bg-accent/10"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <div className="grid grid-cols-1 items-start gap-12 px-10 pt-14 pb-14 lg:grid-cols-[minmax(0,1fr)_500px]">
        <div className="flex flex-col gap-5">
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-accent">
            6-max cash · 100bb · preflop
          </span>

          {/*
            The statement. Instrument Serif at 54px, weight 400 — the face ships
            no other weight, and the deck uses it only at sizes like this.
          */}
          <h1 className="max-w-[540px] font-display text-6xl tracking-[-0.015em]">
            A range is a frequency. Train it like one.
          </h1>

          <p className="max-w-[470px] text-base text-ink-muted">
            <span className="font-mono text-ink">AJo</span> opens 64% of the time on the button.
            Most trainers call that a raise and mark you wrong for folding. This one grades the
            mix on four tiers, scores you by EV lost, and tracks which of ten skills is actually
            leaking.
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-3.5">
            <Link
              href="/sign-up"
              className="inline-flex h-9 items-center rounded-[var(--radius)] border border-accent px-4 text-sm text-accent-hi transition-colors hover:bg-accent/10 active:bg-accent/20"
            >
              Start free — 24-spot placement
            </Link>
            <span className="text-sm text-ink-muted">No card. Desktop, keyboard-first.</span>
          </div>

          <hr className="rule-fade my-3" />

          {/*
            The same ladder `/mastery` renders, with no reader to place on it.
            One component rather than a lookalike: a climb the landing page drew
            differently from the real one would be a promise the product does not
            keep.
          */}
          <RankLadder
            rank={undefined}
            heading="The climb"
            headingClassName="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted"
            caption="Ranks come from EV lost per spot across your last 200 answers — not from time served. They move down as well as up."
          />
        </div>

        {chart ? (
          <section
            id="grades"
            aria-labelledby="grid-heading"
            className="flex flex-col gap-4 rounded-[var(--radius)] border border-line bg-surface p-5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="grid-heading" className="text-sm font-medium">
                {chartLabel(chart)}
              </h2>
              <span className="font-mono text-xs text-ink-muted">
                169 hands · click any of them
              </span>
            </div>

            <HeroGrid chart={chart} label={chartLabel(chart)} />
          </section>
        ) : null}
      </div>

      <section
        id="course"
        aria-labelledby="what-heading"
        className="flex flex-col gap-6 border-t border-line px-10 py-12"
      >
        <h2
          id="what-heading"
          className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted"
        >
          Three things it does
        </h2>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
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
          ].map((card) => (
            <div key={card.title} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{card.title}</h3>
              <p className="text-sm text-ink-muted">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-line px-10 py-12">
        <h2 className="text-sm font-medium">What it is not</h2>
        <p className="max-w-[640px] text-sm text-ink-muted">
          Not a solver. Strategy comes from preflop charts and postflop heuristics, and the app
          covers 6-max cash at 100bb — no tournaments, no ICM, no postflop tree. It runs on a
          laptop, not a phone. If you want a solver, buy a solver.
        </p>
      </section>

      <footer className="flex flex-wrap items-center gap-4 border-t border-line px-10 py-8 text-xs text-ink-muted">
        <span>Poker Trainer</span>
        <Link href="/privacy" className="underline underline-offset-4 hover:text-ink">
          Privacy
        </Link>
        <Link href="/sign-in" className="underline underline-offset-4 hover:text-ink">
          Sign in
        </Link>
      </footer>
    </div>
  );
}
