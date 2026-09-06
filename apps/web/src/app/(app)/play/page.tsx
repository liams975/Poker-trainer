import { BotTableRunner } from '@/components/play/bot-table-runner';
import { requireUser } from '@/lib/auth/dal';
import { fetchChartSet } from '@/lib/charts/queries';

export const metadata = { title: 'Play · Poker Trainer' };

/**
 * A seat at a six-handed cash table, against the engine.
 *
 * `requireUser()` rather than trusting `proxy.ts`, which CLAUDE.md is explicit
 * is UX only and never the security boundary: every protected route calls it
 * itself, and RLS is the real backstop underneath.
 *
 * The chart set is fetched here for the same reason the Range Explorer fetches
 * it here — it is identical for every signed-in user and the cookie is already
 * on the request. The bot consults it first at every decision and falls back to
 * the heuristic only where no chart reaches, so the charts have to be the same
 * ones the drill grades against, loaded the same way.
 */
export default async function PlayPage() {
  await requireUser();
  const chartSet = await fetchChartSet();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-lg font-semibold">Play</h1>
        <p className="text-sm text-ink-muted">
          Six-handed, 100bb, no time bank. Your preflop decisions are graded where a chart
          covers them; everything else is reported after the hand, never scored.
        </p>
      </header>

      <BotTableRunner chartSet={chartSet} />
    </div>
  );
}
