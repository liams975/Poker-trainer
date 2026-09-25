import { HandleOptIn } from '@/components/mastery/handle-opt-in';
import { MasteryMap } from '@/components/mastery/mastery-map';
import { RankLadder } from '@/components/mastery/rank-ladder';
import { WeeklyBoard } from '@/components/mastery/weekly-board';
import { getCharts } from '@/lib/charts/registry';
import { fetchMasterySnapshot } from '@/lib/progress/mastery-queries';
import type { MasterySnapshot } from '@/lib/progress/types';

export const metadata = { title: 'Mastery · Poker Trainer' };

/**
 * The visible-mastery surface — frame 2g of the v2 deck.
 *
 * Three statements about the same history, which is why they are read together
 * in one call: what each skill is worth, what the whole of it ranks as, and
 * where that sits against everyone else who chose to be counted.
 *
 * Nothing on this page is stored. Levels, rank and board position are all
 * derived from `drill_attempts` on read, so a level that should have dropped
 * has already dropped by the time it is rendered.
 */
export default async function MasteryPage() {
  let snapshot: MasterySnapshot | null;

  /**
   * One failure, one degraded page — the same posture the dashboard takes.
   * Mastery is a reflective screen, not a blocking one, and a stats query that
   * times out must not be an error page.
   */
  try {
    const { registry } = await getCharts();
    snapshot = await fetchMasterySnapshot(registry);
  } catch {
    snapshot = null;
  }

  if (snapshot === null) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-6xl tracking-[-0.02em]">Mastery</h1>
        <p className="max-w-[40rem] text-lg text-ink-muted">
          Your progress could not be loaded just now. Nothing has been lost — these figures are
          derived from your answers every time this page opens, so a reload is all it takes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-20">
      <header className="flex flex-col gap-6">
        <span className="label-caps text-ink-muted">Rank · skills · the weekly board</span>
        <h1 className="font-display text-6xl tracking-[-0.02em]">Mastery</h1>
        <p className="max-w-[40rem] text-lg text-ink-muted">
          Measured in EV lost per spot, never in time served — so every figure here can go down as
          well as up.
        </p>
      </header>

      <RankLadder rank={snapshot.rank} n={1} heading="Rank" />

      <MasteryMap
        skills={snapshot.skills}
        levelsEarned={snapshot.levelsEarned}
        levelsAvailable={snapshot.levelsAvailable}
      />

      <div className="flex flex-col gap-8">
        <WeeklyBoard rows={snapshot.board} optedIn={snapshot.participation.optedIn} />
        <HandleOptIn
          handle={snapshot.participation.handle}
          optedIn={snapshot.participation.optedIn}
        />
      </div>
    </div>
  );
}
