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
        <h1 className="font-display text-3xl">Mastery</h1>
        <p className="text-sm text-ink-muted">
          Your progress could not be loaded just now. Nothing has been lost — these figures are
          derived from your answers every time this page opens, so a reload is all it takes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <h1 className="sr-only">Mastery</h1>

      <RankLadder rank={snapshot.rank} />

      <MasteryMap
        skills={snapshot.skills}
        levelsEarned={snapshot.levelsEarned}
        levelsAvailable={snapshot.levelsAvailable}
      />

      <div className="flex flex-col gap-6">
        <WeeklyBoard rows={snapshot.board} optedIn={snapshot.participation.optedIn} />
        <HandleOptIn
          handle={snapshot.participation.handle}
          optedIn={snapshot.participation.optedIn}
        />
      </div>
    </div>
  );
}
