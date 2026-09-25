import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, lookupChart } from '@poker/engine';
import { loadChartRegistry } from '@poker/content';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { HeroGrid } from '@/components/landing/hero-grid';
import { chartLabel } from '@/lib/charts/map';

/**
 * The signed-out shell: the argument on the left, the one thing to do on the
 * right.
 *
 * The figure is the real button chart, interactive, because the product's
 * whole claim — a range is a frequency — is easier to show than to state. It
 * comes from the **bundled** `@poker/content`, for the same reason the landing
 * page's does: RLS correctly refuses an anonymous visitor every `range_charts`
 * row, and nothing is graded against it here.
 *
 * **The form comes first in the DOM** and the figure is moved left by `order`.
 * Tabbing into a sign-in page should reach Email, not 169 grid cells.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const chart = lookupChart(loadChartRegistry(), {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition: 'BTN',
    actionSequence: 'rfi',
  });

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1fr)_31.25rem]">
      <main className="flex flex-col border-line bg-surface px-8 py-12 sm:px-14 lg:order-2 lg:border-l">
        <div className="my-auto flex w-full max-w-sm flex-col self-center py-10 lg:max-w-none">
          {children}
        </div>
        <div className="flex items-center justify-between pt-8">
          <span className="label-caps text-ink-muted">Desktop · keyboard-first</span>
          <Link href="/privacy" className="label-caps text-ink-muted hover:text-ink">
            Privacy
          </Link>
        </div>
      </main>

      <aside className="flex flex-col px-8 py-12 sm:px-14 lg:order-1">
        <div className="flex items-center justify-between gap-6">
          <Link href="/">
            <Wordmark />
          </Link>
          <span className="label-caps hidden text-ink-muted sm:inline">
            6-max cash · 100bb · preflop
          </span>
        </div>

        <p className="mt-16 max-w-[52rem] font-display text-6xl tracking-[-0.02em] xl:text-7xl">
          A range is a <i>frequency.</i>
        </p>
        <p className="mt-5 max-w-xl text-lg text-ink-muted">
          Charts, graded drills and a short course for six-handed cash — graded on the mix, never on
          a single right answer.
        </p>

        {chart ? (
          <div className="mt-12">
            <HeroGrid chart={chart} label={chartLabel(chart)} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
