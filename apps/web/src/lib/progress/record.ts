import type {
  Achievement,
  Day,
  GradeTier,
  SkillStat,
  StatAttempt,
  StreakState,
} from '@poker/engine';
import {
  DAILY_GOAL_SPOTS,
  SCORED_DRILL_MODES,
  XP_ACHIEVEMENT,
  XP_DAILY_GOAL,
  XP_LESSON_COMPLETE,
  advanceStreak,
  effectiveStreak,
  evaluateAchievements,
  isScoredMode,
  levelFor,
  rollUpSkillStats,
  streakStatus,
  totalXp,
  weakSpots,
  xpForAttempts,
} from '@poker/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAchievements } from '@/lib/progress/queries';
import { createClient } from '@/lib/supabase/server';

import { localDay } from './timezone';
import type { SessionRewards, StreakReport } from './types';

/**
 * Awarding progress: XP, streak, skill rollup, achievements.
 *
 * All of it happens on the server, at the one moment a session has an ending,
 * and every number is derived from rows the server itself wrote. The browser
 * asks for a session to be closed; it never states what that session was worth.
 *
 * docs/04-data-model.md is candid that this is not *enforced*: `authenticated`
 * holds `insert` on `xp_events`, and a determined user can still award
 * themselves XP. That is an accepted risk there and it stays one here. What
 * this file avoids is the app's own write path depending on the client for a
 * number — `skill_stats` in particular decides which spots someone is sent back
 * to practise, and a user who can write it can quietly send themselves to drill
 * the wrong thing for a month.
 *
 * Two consequences of the "derive, never accumulate" rule (CLAUDE.md) worth
 * knowing before reading further:
 *
 *   - `skill_stats` is **recomputed** from `drill_attempts`, not incremented.
 *     That makes it reconcilable, idempotent, and immune to the lost update
 *     that an in-application read-modify-write of an exponential average would
 *     hit now that Phase 7 made attempts genuinely concurrent.
 *   - XP totals are always `sum(xp_events.amount)`. Nothing caches them.
 */

/** How far back the rollup reads. Far beyond the EWMA's memory of ~7 answers. */
const ROLLUP_LIMIT = 5_000;

/**
 * A day is bounded by the user's local midnight, and no offset arithmetic here
 * knows where that is. So "today" is found by pulling a generous window and
 * asking `localDay` about each row — 48 hours covers every zone from -12 to
 * +14 with room to spare.
 */
const LOCAL_DAY_WINDOW_MS = 48 * 60 * 60 * 1000;

function fail(message: string): never {
  throw new Error(message);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type { DailyGoalReport, SessionRewards, StreakReport } from './types';

interface AttemptRow {
  grade: GradeTier;
  ev_loss: number | string;
  skill_tags: string[] | null;
  created_at: string;
}

function toStatAttempts(rows: readonly AttemptRow[]): StatAttempt[] {
  return rows.flatMap((row) =>
    (row.skill_tags ?? []).map((skillTag) => ({
      skillTag,
      tier: row.grade,
      // `numeric` arrives from PostgREST as a string; Number('') is 0, which
      // would understate a leak rather than shout about it.
      evLoss: Number(row.ev_loss ?? 0),
    })),
  );
}

/** The caller's timezone, falling back the way the signup trigger does. */
async function readTimezone(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.from('profiles').select('timezone').maybeSingle();
  return (data?.timezone as string | undefined) ?? 'UTC';
}

/**
 * Every attempt of this user's that counts, oldest first.
 *
 * `!inner` on the session is what excludes `study` and `placement`: their rows
 * are real history and stay in the table, but a mode that shows the answer
 * first must not move a number claiming to describe recall. An attempt whose
 * session was deleted has `session_id` null and no mode, so it drops out here
 * too — which is the honest reading of a row that can no longer say what it was.
 */
async function readScoredAttempts(supabase: SupabaseClient): Promise<AttemptRow[]> {
  const { data, error } = await supabase
    .from('drill_attempts')
    .select('grade, ev_loss, skill_tags, created_at, drill_sessions!inner(mode)')
    .in('drill_sessions.mode', [...SCORED_DRILL_MODES])
    .order('created_at', { ascending: true })
    .limit(ROLLUP_LIMIT);

  if (error) fail(`could not read the attempt history: ${error.message}`);

  return (data ?? []) as unknown as AttemptRow[];
}

/**
 * Rewrites `skill_stats` from the attempt log.
 *
 * Recomputed rather than incremented, so running it twice is a no-op and a
 * stale row from an abandoned session is corrected rather than compounded.
 */
async function refreshSkillStats(
  supabase: SupabaseClient,
  userId: string,
  attempts: readonly AttemptRow[],
): Promise<readonly SkillStat[]> {
  const stats = rollUpSkillStats(toStatAttempts(attempts));
  if (stats.length === 0) return stats;

  const lastSeen = attempts.at(-1)?.created_at ?? new Date().toISOString();

  const { error } = await supabase.from('skill_stats').upsert(
    stats.map((stat) => ({
      user_id: userId,
      skill_tag: stat.skillTag,
      attempts: stat.attempts,
      correct: stat.correct,
      ewma_accuracy: stat.ewmaAccuracy,
      avg_ev_loss: stat.avgEvLoss,
      last_seen_at: lastSeen,
    })),
    { onConflict: 'user_id,skill_tag' },
  );

  if (error) fail(`could not update the skill rollup: ${error.message}`);

  return stats;
}

/**
 * Writes one XP event, tolerating the case where it is already there.
 *
 * `xp_events_once_per_ref` makes a repeated award a unique violation rather
 * than a duplicate row. That is the point: a retried PATCH must not double
 * somebody's XP, and because every total is `sum(amount)` there would be
 * nothing afterwards to notice it by.
 */
async function awardXp(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  refId: string | null,
): Promise<number> {
  if (amount === 0) return 0;

  const { error } = await supabase
    .from('xp_events')
    .insert({ user_id: userId, amount, reason, ref_id: refId });

  if (error) {
    // 23505: already awarded. Not a failure — it is the constraint doing its job.
    if (error.code === '23505') return 0;
    fail(`could not award XP: ${error.message}`);
  }

  return amount;
}

async function readTotalXp(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.from('xp_events').select('amount');
  if (error) fail(`could not read the XP ledger: ${error.message}`);

  return totalXp((data ?? []) as { amount: number }[]);
}

async function readStreakState(supabase: SupabaseClient): Promise<StreakState> {
  const { data, error } = await supabase
    .from('streaks')
    .select('current_streak, longest_streak, last_active_date')
    .maybeSingle();

  if (error) fail(`could not read the streak: ${error.message}`);

  return {
    current: (data?.current_streak as number | undefined) ?? 0,
    longest: (data?.longest_streak as number | undefined) ?? 0,
    lastActiveDate: (data?.last_active_date as string | null | undefined) ?? null,
  };
}

/** The streak as it stands, without recording anything. */
async function readStreak(supabase: SupabaseClient, today: Day): Promise<StreakReport> {
  const state = await readStreakState(supabase);

  return {
    // The stored counter is only true as of `last_active_date`; a broken streak
    // still has its old number sitting in the column.
    current: effectiveStreak(state, today),
    longest: state.longest,
    status: streakStatus(state, today),
    extendedToday: false,
  };
}

/**
 * Advances the streak, if today has not been counted yet.
 *
 * Both counters go in one `update`. `streaks_longest_is_longest` forbids the
 * intermediate state where `current` has been bumped past `longest`, so writing
 * them in sequence would fail the constraint on exactly the day a personal best
 * is set — the day it most matters.
 */
async function touchStreak(
  supabase: SupabaseClient,
  userId: string,
  today: Day,
): Promise<StreakReport> {
  const state = await readStreakState(supabase);
  const next = advanceStreak({ state, today });

  if (next.changed) {
    const { error: writeError } = await supabase
      .from('streaks')
      .upsert(
        {
          user_id: userId,
          current_streak: next.current,
          longest_streak: next.longest,
          last_active_date: next.lastActiveDate,
        },
        { onConflict: 'user_id' },
      );

    if (writeError) fail(`could not update the streak: ${writeError.message}`);
  }

  return {
    current: next.current,
    longest: next.longest,
    status: streakStatus(next, today),
    extendedToday: next.changed,
  };
}

/** How many scored spots the user has answered today, in their own zone. */
function countToday(
  attempts: readonly AttemptRow[],
  timeZone: string,
  today: Day,
): number {
  const since = Date.now() - LOCAL_DAY_WINDOW_MS;

  return attempts.filter((row) => {
    const at = new Date(row.created_at);
    if (Number.isNaN(at.getTime()) || at.getTime() < since) return false;
    return localDay(timeZone, at) === today;
  }).length;
}

async function recordAchievements(
  supabase: SupabaseClient,
  userId: string,
  snapshotStats: readonly SkillStat[],
  spots: number,
  streak: number,
  lessonsCompleted: number,
): Promise<readonly Achievement[]> {
  const catalogue = await fetchAchievements();
  if (catalogue.length === 0) return [];

  const earned = new Set(
    evaluateAchievements(catalogue, {
      spots,
      streak,
      lessonsCompleted,
      stats: snapshotStats,
    }),
  );

  if (earned.size === 0) return [];

  /**
   * `ignoreDuplicates` makes this `on conflict do nothing`, and PostgREST
   * returns only the rows it actually inserted. That is what makes "newly
   * unlocked" a fact rather than a guess — and it is also the only thing
   * stopping the achievement XP below from being paid twice, since
   * `achievements.id` is text and cannot go in `xp_events.ref_id`.
   */
  const { data, error } = await supabase
    .from('user_achievements')
    .upsert(
      [...earned].map((achievementId) => ({ user_id: userId, achievement_id: achievementId })),
      { onConflict: 'user_id,achievement_id', ignoreDuplicates: true },
    )
    .select('achievement_id');

  if (error) fail(`could not record achievements: ${error.message}`);

  const fresh = new Set((data ?? []).map((row) => String(row.achievement_id)));

  return catalogue.filter((entry) => fresh.has(entry.id));
}

async function countCompletedLessons(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('lesson_progress')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'completed');

  if (error) fail(`could not count completed lessons: ${error.message}`);

  return count ?? 0;
}

/** Whether the daily-goal bonus has already been paid for `today`. */
async function dailyGoalPaid(
  supabase: SupabaseClient,
  timeZone: string,
  today: Day,
): Promise<boolean> {
  const since = new Date(Date.now() - LOCAL_DAY_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from('xp_events')
    .select('created_at')
    .eq('reason', 'daily_goal')
    .gte('created_at', since);

  if (error) fail(`could not read the XP ledger: ${error.message}`);

  return (data ?? []).some((row) => localDay(timeZone, new Date(row.created_at as string)) === today);
}

/**
 * Closes a drill session and pays out everything it earned.
 *
 * Returns `null` when there was nothing to close — a session already completed,
 * or one belonging to somebody else, which RLS turns into the same empty result.
 * That `completed_at is null` guard is the first line of defence against a
 * retried PATCH paying twice; `xp_events_once_per_ref` is the second.
 */
export async function awardSessionRewards(
  userId: string,
  sessionId: string,
): Promise<SessionRewards | null> {
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) fail('sessionId must be a uuid');

  const supabase = await createClient();

  // No user_id filter: RLS scopes this to the caller's own rows, and adding one
  // would suggest the policy were optional.
  const { data: closed, error: closeError } = await supabase
    .from('drill_sessions')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('completed_at', null)
    .select('id, mode');

  if (closeError) fail(`could not close the session: ${closeError.message}`);
  if (!closed || closed.length === 0) return null;

  const mode = String(closed[0]!.mode);

  const timeZone = await readTimezone(supabase);
  const today = localDay(timeZone);

  const { data: sessionAttempts, error: sessionAttemptsError } = await supabase
    .from('drill_attempts')
    .select('grade')
    .eq('session_id', sessionId);

  if (sessionAttemptsError) {
    fail(`could not read the session's attempts: ${sessionAttemptsError.message}`);
  }

  const tiers = (sessionAttempts ?? []).map((row) => row.grade as GradeTier);

  /**
   * The streak counts *any* completed session with an answer in it, scored or
   * not. Somebody who spent their evening in Study mode reading charts did show
   * up, and the streak is a record of showing up. XP and the skill rollup are a
   * record of what somebody can do without looking, which is why those two stop
   * at `isScoredMode`.
   *
   * A session nobody answered is a different thing: closing it is right, paying
   * for it is not, and neither is calling it a day of practice.
   */
  const streak =
    tiers.length === 0
      ? await readStreak(supabase, today)
      : await touchStreak(supabase, userId, today);

  if (tiers.length === 0 || !isScoredMode(mode)) {
    const total = await readTotalXp(supabase);
    return {
      xpAwarded: 0,
      totalXp: total,
      level: levelFor(total),
      // Nothing was paid, so the level cannot have moved.
      levelBefore: levelFor(total).level,
      streak,
      dailyGoal: { done: 0, target: DAILY_GOAL_SPOTS, met: false },
      unlocked: [],
      weakSpots: [],
    };
  }

  let xpAwarded = await awardXp(
    supabase,
    userId,
    xpForAttempts(tiers),
    'drill_session',
    sessionId,
  );

  const history = await readScoredAttempts(supabase);
  const stats = await refreshSkillStats(supabase, userId, history);

  const doneToday = countToday(history, timeZone, today);
  const metGoal = doneToday >= DAILY_GOAL_SPOTS;

  if (metGoal && !(await dailyGoalPaid(supabase, timeZone, today))) {
    xpAwarded += await awardXp(supabase, userId, XP_DAILY_GOAL, 'daily_goal', null);
  }

  const unlocked = await recordAchievements(
    supabase,
    userId,
    stats,
    history.length,
    streak.current,
    await countCompletedLessons(supabase),
  );

  if (unlocked.length > 0) {
    // One event for the batch rather than one each. `achievements.id` is text
    // and cannot go in `ref_id`, so per-achievement rows would be
    // indistinguishable from each other anyway — and what makes this safe to
    // pay at all is that `unlocked` holds only rows this call inserted.
    xpAwarded += await awardXp(
      supabase,
      userId,
      XP_ACHIEVEMENT * unlocked.length,
      'achievement',
      null,
    );
  }

  const total = await readTotalXp(supabase);

  return {
    xpAwarded,
    totalXp: total,
    level: levelFor(total),
    /**
     * Subtracted, not queried.
     *
     * `xpAwarded` is exactly what *this* call wrote — `awardXp` returns 0 when
     * the unique index rejects a retry — so `total - xpAwarded` is the ledger
     * as it stood before the session closed. Reading the total a second time
     * before awarding would be a second round trip and would still be wrong
     * under a concurrent write; this cannot disagree with the number beside it
     * because it is computed from it.
     */
    levelBefore: levelFor(total - xpAwarded).level,
    streak,
    dailyGoal: { done: doneToday, target: DAILY_GOAL_SPOTS, met: metGoal },
    unlocked,
    weakSpots: weakSpots(stats),
  };
}

/**
 * Pays for a lesson the reader just finished.
 *
 * Separate from the drill path because a lesson is not a session, but it obeys
 * the same two rules: the amount comes from the schedule rather than from the
 * request, and `ref_id` makes a second call a no-op rather than a second
 * payment. Called by `lib/lessons/record.ts` after the progress row lands.
 */
export async function awardLessonCompletion(
  userId: string,
  lessonId: string,
): Promise<{ xpAwarded: number; streak: StreakReport }> {
  const supabase = await createClient();
  const timeZone = await readTimezone(supabase);
  const today = localDay(timeZone);

  const xpAwarded = await awardXp(supabase, userId, XP_LESSON_COMPLETE, 'lesson_complete', lessonId);
  const streak = await touchStreak(supabase, userId, today);

  return { xpAwarded, streak };
}
