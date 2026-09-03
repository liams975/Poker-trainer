import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, lookupChart } from '@poker/engine';
import { loadChartRegistry } from '@poker/content';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { HeroGrid } from '@/components/landing/hero-grid';
import { Button } from '@/components/ui/button';
import { chartLabel } from '@/lib/charts/map';
import { getCurrentUser } from '@/lib/auth/dal';

export const metadata = {
  title: 'Poker Trainer — learn 6-max preflop properly',
  description:
    'Range charts, graded drills and a course for 6-max cash. Grades the mix, not a single right answer.',
};

/**
 * The landing page, and the router for everyone who already has an account.
 *
 * `isPublicPath` treats `/` as public so the proxy lets it through and this
 * decides — signed in goes to the dashboard, signed out gets the page below.
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-6 py-16">
      <header className="flex items-center justify-between">
        <span className="font-display text-sm font-semibold tracking-tight">Poker Trainer</span>
        <Link
          href="/sign-in"
          className="text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          Sign in
        </Link>
      </header>

      <section className="flex flex-col gap-6">
        <h1 className="max-w-2xl font-display text-3xl font-semibold leading-tight">
          Learn 6-max preflop properly.
        </h1>

        <p className="max-w-2xl text-base text-ink-muted">
          Most training tools tell you a hand is a raise or a fold. Real ranges are mixed —{' '}
          <span className="font-mono text-ink">AJo</span> might open 60% of the time and fold the
          rest. This one teaches the mix, grades against it, and never tells you that a
          positive-frequency line was wrong.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href="/sign-up">Start free</Link>
          </Button>
          <span className="text-xs text-ink-muted">
            No card. Desktop, keyboard-first.
          </span>
        </div>
      </section>

      {chart ? (
        <section aria-labelledby="grid-heading" className="flex flex-col gap-4">
          <h2 id="grid-heading" className="text-xs uppercase tracking-wider text-ink-muted">
            This is a range
          </h2>
          <HeroGrid chart={chart} label={chartLabel(chart)} />
        </section>
      ) : null}

      <section aria-labelledby="what-heading" className="flex flex-col gap-6">
        <h2 id="what-heading" className="text-xs uppercase tracking-wider text-ink-muted">
          Three things it does
        </h2>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
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
              <h3 className="font-display text-sm font-semibold">{card.title}</h3>
              <p className="text-sm text-ink-muted">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-8">
        <h2 className="font-display text-sm font-semibold">What it is not</h2>
        <p className="max-w-2xl text-sm text-ink-muted">
          Not a solver. Strategy comes from preflop charts and postflop heuristics, and the app
          covers 6-max cash at 100bb — no tournaments, no ICM, no postflop tree. It runs on a
          laptop, not a phone. If you want a solver, buy a solver.
        </p>
      </section>

      <footer className="flex flex-wrap items-center gap-4 border-t border-line pt-8 text-xs text-ink-muted">
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
