import type { ChartRegistry, MasteryAttempt } from '@poker/engine';
import { MASTERY_LEVELS, masteryFor, rankFor } from '@poker/engine';

import { createClient } from '@/lib/supabase/server';

import { skillLabel } from './skill-label';
import type { BoardRow, MasterySnapshot, SkillMastery } from './types';

/**
 * The mastery map, the rank and the weekly board — frame 2g of the v2 deck.
 *
 * Every figure is derived from `drill_attempts` on read, the same rule the rest
 * of `queries.ts` follows. Nothing here is a counter, which is why a level can
 * drop back without anybody having to remember to decrement something.
 *
 * RLS scopes the attempt read; no query here names a user id. The board is the
 * one exception in the whole app and does not go through a table at all — it is
 * a security-definer function that returns aggregates for opted-in players only.
 * See `supabase/migrations/0007_handles_and_weekly_board.sql`.
 */

/**
 * How far back to read.
 *
 * Ranking needs the last 200 answers and each skill needs its last 30, so the
 * bound has to cover the worst realistic split: a reader who has drilled one
 * skill almost exclusively will have older answers on their neglected ones.
 * 2000 covers ten skills at their full window many times over, and caps a query
 * that would otherwise grow without limit as somebody's history does.
 *
 * The cost of the bound is precise and small: a skill untouched for 2000
 * answers reads as having fewer than 30 recent attempts and shows as locked,
 * which is a fair description of a skill that has not been practised in two
 * thousand spots.
 */
const ATTEMPT_WINDOW = 2000;

interface AttemptRow {
  ev_loss: number | string;
  skill_tags: string[] | null;
}

interface BoardRpcRow {
  rank_position: number | string;
  handle: string;
  ev_loss_per_spot: number | string;
  spots: number | string;
  is_you: boolean;
}

/** `numeric` arrives from PostgREST as a string, to avoid float precision loss. */
function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number.parseFloat(value);
}

/**
 * Everything 2g renders, in one read.
 *
 * One function rather than three for the same reason `fetchTodaySnapshot` is
 * one: the screen shows the rank, the map and the board together, and they are
 * all statements about the same set of attempts. Reading them separately is how
 * a rank and a mastery level end up describing different histories.
 */
export async function fetchMasterySnapshot(
  registry: ChartRegistry,
): Promise<MasterySnapshot> {
  const supabase = await createClient();

  const [attemptResult, profileResult, boardResult] = await Promise.all([
    supabase
      .from('drill_attempts')
      .select('ev_loss, skill_tags')
      // Newest first is what an index can serve; the engine wants oldest-first,
      // so the array is reversed below rather than sorted again in the database.
      .order('created_at', { ascending: false })
      .limit(ATTEMPT_WINDOW),
    supabase.from('profiles').select('handle, leaderboard_opted_in').maybeSingle(),
    supabase.rpc('weekly_leaderboard', { row_limit: 10 }),
  ]);

  if (attemptResult.error) {
    throw new Error(`could not load attempts: ${attemptResult.error.message}`);
  }

  const attempts = [...(attemptResult.data ?? [])].reverse() as AttemptRow[];

  // Every tag an attempt carries gets that attempt. `skill_tags` is a text[],
  // so one answer can be evidence about more than one skill — and dropping all
  // but the first tag would quietly under-count the skills that share spots.
  const byTag = new Map<string, MasteryAttempt[]>();
  const ranked: MasteryAttempt[] = [];

  for (const row of attempts) {
    const attempt: MasteryAttempt = { evLoss: toNumber(row.ev_loss) };
    ranked.push(attempt);

    for (const tag of row.skill_tags ?? []) {
      const existing = byTag.get(tag);
      if (existing) existing.push(attempt);
      else byTag.set(tag, [attempt]);
    }
  }

  /**
   * The skill list comes from the chart registry, not from the attempt log, so
   * a skill the reader has never touched still appears — locked, with what
   * opens it. A map built only from what somebody has already drilled can never
   * show them what they have not.
   */
  const tags = new Set<string>();
  for (const chart of registry.values()) {
    for (const tag of chart.skillTags) tags.add(tag);
  }
  for (const tag of byTag.keys()) tags.add(tag);

  const skills: SkillMastery[] = [...tags]
    .sort()
    .map((skillTag) => {
      const forTag = byTag.get(skillTag) ?? [];

      return {
        ...masteryFor(forTag),
        skillTag,
        label: skillLabel(skillTag, registry),
        accuracy: null,
      };
    });

  return {
    skills,
    levelsEarned: skills.reduce((total, skill) => total + skill.level, 0),
    levelsAvailable: skills.length * MASTERY_LEVELS,
    rank: rankFor(ranked),
    board: readBoard(boardResult),
    participation: {
      optedIn: profileResult.data?.leaderboard_opted_in ?? false,
      handle: profileResult.data?.handle ?? null,
    },
  };
}

/**
 * The board degrades to empty rather than throwing.
 *
 * It is the one part of this screen that reads other people's data, and the
 * only part the reader cannot act on. A leaderboard outage must not take the
 * reader's own mastery map down with it.
 */
function readBoard(result: { data: unknown; error: unknown }): readonly BoardRow[] {
  if (result.error || !Array.isArray(result.data)) return [];

  return (result.data as BoardRpcRow[]).map((row) => ({
    position: toNumber(row.rank_position),
    handle: row.handle,
    evLossPerSpot: toNumber(row.ev_loss_per_spot),
    spots: toNumber(row.spots),
    isYou: row.is_you,
  }));
}
