import type { Achievement, LevelProgress, SkillStat, StreakStatus } from '@poker/engine';
import {
  DAILY_GOAL_SPOTS,
  SCORED_DRILL_MODES,
  effectiveStreak,
  levelFor,
  parseAchievements,
  streakStatus,
  totalXp,
  weakSpots,
} from '@poker/engine';
import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';

import { localDay } from './timezone';

/**
 * Reading progress for the dashboard.
 *
 * Every figure here is derived: XP from the ledger, the streak from its stored
 * pair plus today's date, weak spots from the `skill_stats` rollup. Nothing is
 * a counter this file maintains, which is CLAUDE.md's rule and also what makes
 * the numbers reconcilable against the tables they came from.
 *
 * RLS does all the scoping. None of these queries names a user id, and adding
 * one would suggest the policies were optional.
 */

/** Matches `record.ts`: a window wide enough to contain any zone's local day. */
const LOCAL_DAY_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Sessions shown in the rail's Recent section. */
const RECENT_SESSION_LIMIT = 5;

export interface RecentSession {
  id: string;
  mode: string;
  spots: number;
  completedAt: string;
}

export interface TodaySnapshot {
  streak: { current: number; longest: number; status: StreakStatus };
  dailyGoal: { done: number; target: number };
  xp: { total: number; level: LevelProgress };
  /** Recent accuracy across every tracked skill, or null with nothing to average. */
  accuracy: number | null;
  weakSpots: readonly SkillStat[];
  recent: readonly RecentSession[];
  unlocked: readonly Achievement[];
}

/**
 * The achievement catalogue, from the database rather than from
 * `@poker/content`.
 *
 * Same rule the charts and templates follow: reading the bundled copy would
 * make `pnpm content:sync` decorative, and would show somebody a badge for
 * criteria the deployed database has never heard of. Validated on the way in,
 * because `criteria` is an opaque jsonb column written by a service-role script.
 */
export const fetchAchievements = cache(async (): Promise<readonly Achievement[]> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('achievements')
    .select('id, title, description, criteria')
    .order('id');

  if (error) throw new Error(`could not load achievements: ${error.message}`);

  const parsed = parseAchievements(data ?? []);

  if (!parsed.ok) {
    throw new Error(
      `the achievements table holds invalid criteria:\n${parsed.errors
        .map((e) => `  ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }

  return parsed.value;
});

/**
 * Everything the TODAY strip and the rail need, in one place.
 *
 * Deliberately one function rather than six: the dashboard renders these
 * together and they share a timezone lookup and a day boundary, and resolving
 * "today" twice in one request is how two numbers on one screen end up
 * disagreeing across midnight.
 */
export async function fetchTodaySnapshot(): Promise<TodaySnapshot> {
  const supabase = await createClient();

  const [profileResult, streakResult, xpResult, statsResult] = await Promise.all([
    supabase.from('profiles').select('timezone').maybeSingle(),
    supabase.from('streaks').select('current_streak, longest_streak, last_active_date').maybeSingle(),
    supabase.from('xp_events').select('amount'),
    supabase.from('skill_stats').select('skill_tag, attempts, correct, ewma_accuracy, avg_ev_loss'),
  ]);

  const timeZone = (profileResult.data?.timezone as string | undefined) ?? 'UTC';
  const today = localDay(timeZone);

  const streakState = {
    current: (streakResult.data?.current_streak as number | undefined) ?? 0,
    longest: (streakResult.data?.longest_streak as number | undefined) ?? 0,
    lastActiveDate: (streakResult.data?.last_active_date as string | null | undefined) ?? null,
  };

  const stats: SkillStat[] = (statsResult.data ?? []).map((row) => ({
    skillTag: String(row.skill_tag),
    attempts: Number(row.attempts),
    correct: Number(row.correct),
    ewmaAccuracy: Number(row.ewma_accuracy),
    avgEvLoss: Number(row.avg_ev_loss),
  }));

  const [done, recent, unlocked] = await Promise.all([
    countTodaysSpots(supabase, timeZone, today),
    fetchRecentSessions(supabase),
    fetchUnlockedAchievements(supabase),
  ]);

  return {
    streak: {
      current: effectiveStreak(streakState, today),
      longest: streakState.longest,
      status: streakStatus(streakState, today),
    },
    dailyGoal: { done, target: DAILY_GOAL_SPOTS },
    xp: {
      total: totalXp((xpResult.data ?? []) as { amount: number }[]),
      level: levelFor(totalXp((xpResult.data ?? []) as { amount: number }[])),
    },
    accuracy: overallAccuracy(stats),
    weakSpots: weakSpots(stats),
    recent,
    unlocked,
  };
}

/**
 * One accuracy figure for the strip, weighted by how much each skill was
 * practised — an unweighted mean would let one lightly-drilled tag swing the
 * headline number.
 *
 * Null, not zero, when there is nothing to average: "no data" and "0%" are
 * different claims and only the first one is true for a new account.
 */
function overallAccuracy(stats: readonly SkillStat[]): number | null {
  const attempts = stats.reduce((sum, stat) => sum + stat.attempts, 0);
  if (attempts === 0) return null;

  const weighted = stats.reduce((sum, stat) => sum + stat.ewmaAccuracy * stat.attempts, 0);

  return weighted / attempts;
}

/**
 * Today's scored spots.
 *
 * A local day is bounded by a midnight this code cannot compute with offset
 * arithmetic without reintroducing the DST bug, so it pulls a 48-hour window —
 * wide enough for every zone from -12 to +14 — and asks `localDay` about each
 * row. The window keeps the query bounded; `localDay` keeps it correct.
 */
async function countTodaysSpots(
  supabase: Awaited<ReturnType<typeof createClient>>,
  timeZone: string,
  today: string,
): Promise<number> {
  const since = new Date(Date.now() - LOCAL_DAY_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from('drill_attempts')
    .select('created_at, drill_sessions!inner(mode)')
    .in('drill_sessions.mode', [...SCORED_DRILL_MODES])
    .gte('created_at', since);

  if (error) throw new Error(`could not count today's spots: ${error.message}`);

  return (data ?? []).filter(
    (row) => localDay(timeZone, new Date(row.created_at as string)) === today,
  ).length;
}

async function fetchRecentSessions(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<readonly RecentSession[]> {
  const { data, error } = await supabase
    .from('drill_sessions')
    .select('id, mode, completed_at, drill_attempts(count)')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(RECENT_SESSION_LIMIT);

  if (error) throw new Error(`could not load recent sessions: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    mode: String(row.mode),
    // PostgREST returns an aggregate embed as `[{ count: n }]`.
    spots: Number((row.drill_attempts as { count: number }[] | null)?.[0]?.count ?? 0),
    completedAt: String(row.completed_at),
  }));
}

async function fetchUnlockedAchievements(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<readonly Achievement[]> {
  const { data, error } = await supabase
    .from('user_achievements')
    .select('achievement_id')
    .order('unlocked_at', { ascending: false });

  if (error) throw new Error(`could not load unlocked achievements: ${error.message}`);

  const unlocked = new Set((data ?? []).map((row) => String(row.achievement_id)));
  const catalogue = await fetchAchievements();

  return catalogue.filter((entry) => unlocked.has(entry.id));
}
