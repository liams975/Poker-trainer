import type {
  ActionFreq,
  Day,
  DayPoint,
  DrillScenario,
  GradeTier,
  HistoryAttempt,
  SessionDigest,
} from '@poker/engine';
import { GRADE_TIERS, accuracyOverTime, addDays, isDay, sessionDigest } from '@poker/engine';

import { localDay } from '@/lib/progress/timezone';
import { createClient } from '@/lib/supabase/server';

import {
  REVIEW_MODES,
  type AttemptRow,
  type ReviewFilters,
  type SessionRow,
} from './filters';

/**
 * Reading a user's own history back.
 *
 * **No query here names a user id.** RLS scopes every one of these to the
 * caller — `"attempts: own"` and `"sessions: own"` have been in place since
 * Phase 4 — and adding a filter would quietly turn the policy into a
 * convenience that a future refactor could drop without anything failing. The
 * same rule the rest of this codebase follows.
 *
 * Two things this deliberately does *not* do:
 *
 *   - It does not re-grade anything. `drill_attempts.frequencies` holds the
 *     distribution the answer was actually graded against, along with the
 *     `chart_version` it came from. Re-deriving from today's charts would let a
 *     retune rewrite history, which is the exact failure `chart_version` exists
 *     to prevent (docs/01-architecture.md).
 *   - It does not decide what day it is. The reader's timezone comes from their
 *     profile and goes through `localDay`, the single place in this app that
 *     turns an instant into a date.
 */

/** How far back the history view looks by default. */
export const DEFAULT_HISTORY_DAYS = 30;

/** Rows per page in the session list and the mistake log. */
export const PAGE_SIZE = 25;

/** Matches the `spots_planned` constraint's ceiling from migration 0002. */
const MAX_SESSION_SPOTS = 500;

/** Enough for a very heavy month; a ceiling rather than an expectation. */
const HISTORY_ATTEMPT_LIMIT = 5_000;

/**
 * Re-exported so a server caller has one import, while every client component
 * takes them from `./filters` — which has no server dependency and therefore
 * cannot drag `next/headers` into a browser bundle.
 */
export {
  REVIEW_MODES,
  type AttemptRow,
  type ReviewFilters,
  type ReviewMode,
  type SessionRow,
} from './filters';

/** The caller's timezone, falling back the way the signup trigger does. */
async function readTimezone(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('timezone').maybeSingle();
  return (data?.timezone as string | undefined) ?? 'UTC';
}

function toAttemptRow(row: Record<string, unknown>, timeZone: string): AttemptRow {
  const createdAt = String(row.created_at);
  const scenario = (row.scenario ?? {}) as DrillScenario;

  return {
    id: String(row.id),
    sessionId: row.session_id === null ? null : String(row.session_id),
    createdAt,
    day: localDay(timeZone, new Date(createdAt)),
    scenario,
    hand: String(scenario.hand ?? ''),
    userAction: String(row.user_action),
    userSize: row.user_size === null ? null : Number(row.user_size),
    frequencies: (row.frequencies ?? []) as readonly ActionFreq[],
    grade: row.grade as GradeTier,
    // `numeric` arrives from PostgREST as a string.
    evLoss: Number(row.ev_loss ?? 0),
    responseMs: row.response_ms === null ? null : Number(row.response_ms),
    skillTags: (row.skill_tags ?? []) as readonly string[],
    chartVersion: String(row.chart_version),
  };
}

const ATTEMPT_COLUMNS =
  'id, session_id, created_at, scenario, user_action, user_size, frequencies, grade, ' +
  'ev_loss, response_ms, skill_tags, chart_version';

/**
 * Turns a filter's inclusive local dates into the instants to compare against.
 *
 * A day in the reader's zone is not a day in UTC, and `created_at` is a
 * `timestamptz`. Rather than compute the zone's offset — the arithmetic that
 * `progress/day.ts` exists to keep out of this codebase — the range is widened
 * by a day at each end and the exact boundary is applied in TypeScript by
 * asking `localDay` about each row. The window keeps the query bounded;
 * `localDay` keeps it correct.
 */
function instantWindow(filters: ReviewFilters): { since?: string; until?: string } {
  const window: { since?: string; until?: string } = {};

  if (filters.from !== undefined && isDay(filters.from)) {
    window.since = `${addDays(filters.from, -1)}T00:00:00.000Z`;
  }
  if (filters.to !== undefined && isDay(filters.to)) {
    window.until = `${addDays(filters.to, 2)}T00:00:00.000Z`;
  }

  return window;
}

function withinDays(row: AttemptRow, filters: ReviewFilters): boolean {
  if (filters.from !== undefined && isDay(filters.from) && row.day < filters.from) return false;
  if (filters.to !== undefined && isDay(filters.to) && row.day > filters.to) return false;
  return true;
}

/**
 * Attempts matching the filters, newest first.
 *
 * `skillTag` filtering uses `contains` against the `text[]` column, which the
 * GIN index from 0001 serves. `grade` and the date range are applied in the
 * database too; only the exact local-day boundary is finished off here, for the
 * reason `instantWindow` gives.
 */
export async function fetchAttempts(
  filters: ReviewFilters = {},
  limit = PAGE_SIZE,
): Promise<readonly AttemptRow[]> {
  const supabase = await createClient();
  const timeZone = await readTimezone();
  const window = instantWindow(filters);

  let query = supabase
    .from('drill_attempts')
    .select(`${ATTEMPT_COLUMNS}, drill_sessions!inner(mode)`)
    .order('created_at', { ascending: false })
    // Over-fetch a little, because the local-day trim below can only remove
    // rows. Two extra days at the edges is at most a couple of sessions.
    .limit(limit * 2 + 50);

  if (filters.grade !== undefined && GRADE_TIERS.includes(filters.grade)) {
    query = query.eq('grade', filters.grade);
  }
  if (filters.skillTag !== undefined && filters.skillTag.length > 0) {
    query = query.contains('skill_tags', [filters.skillTag]);
  }
  if (filters.mode !== undefined && REVIEW_MODES.includes(filters.mode)) {
    query = query.eq('drill_sessions.mode', filters.mode);
  }
  if (window.since) query = query.gte('created_at', window.since);
  if (window.until) query = query.lt('created_at', window.until);

  const { data, error } = await query;
  if (error) throw new Error(`could not load your attempts: ${error.message}`);

  return (data ?? [])
    .map((row) => toAttemptRow(row as Record<string, unknown>, timeZone))
    .filter((row) => withinDays(row, filters))
    .slice(0, limit);
}

/** Completed and abandoned sessions alike, newest first. */
export async function fetchSessions(
  filters: ReviewFilters = {},
  limit = PAGE_SIZE,
): Promise<readonly SessionRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('drill_sessions')
    .select('id, mode, started_at, completed_at, drill_attempts(count)')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (filters.mode !== undefined && REVIEW_MODES.includes(filters.mode)) {
    query = query.eq('mode', filters.mode);
  }

  const { data, error } = await query;
  if (error) throw new Error(`could not load your sessions: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    mode: String(row.mode),
    startedAt: String(row.started_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at),
    // PostgREST returns an aggregate embed as `[{ count: n }]`.
    spots: Number((row.drill_attempts as { count: number }[] | null)?.[0]?.count ?? 0),
  }));
}

export interface SessionDetail {
  session: SessionRow;
  attempts: readonly AttemptRow[];
  digest: SessionDigest;
}

/**
 * One session and everything in it.
 *
 * Returns null rather than throwing when the id is unknown — which, thanks to
 * RLS, is also what somebody else's session id looks like from here. The route
 * turns that into a 404, so a probe cannot tell "does not exist" from "is not
 * yours".
 */
export async function fetchSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const supabase = await createClient();
  const timeZone = await readTimezone();

  const { data: session, error } = await supabase
    .from('drill_sessions')
    .select('id, mode, started_at, completed_at')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) throw new Error(`could not load that session: ${error.message}`);
  if (!session) return null;

  const { data: rows, error: attemptError } = await supabase
    .from('drill_attempts')
    .select(ATTEMPT_COLUMNS)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    // `drill_sessions_spots_planned_sane` caps a session at 500, and an endless
    // session draws in batches of 25 — so this is generous rather than tight.
    // Explicit anyway: PostgREST's own default cap is a server setting, not a
    // promise this code gets to rely on.
    .limit(MAX_SESSION_SPOTS);

  if (attemptError) throw new Error(`could not load that session: ${attemptError.message}`);

  const attempts = (rows ?? []).map((row) =>
    toAttemptRow(row as unknown as Record<string, unknown>, timeZone),
  );

  return {
    session: {
      id: String(session.id),
      mode: String(session.mode),
      startedAt: String(session.started_at),
      completedAt: session.completed_at === null ? null : String(session.completed_at),
      spots: attempts.length,
    },
    attempts,
    digest: sessionDigest(attempts as unknown as readonly HistoryAttempt[]),
  };
}

export interface HistoryView {
  points: readonly DayPoint[];
  from: Day;
  to: Day;
}

/** Accuracy per day over the last `days`, ending today in the reader's zone. */
export async function fetchAccuracyHistory(days = DEFAULT_HISTORY_DAYS): Promise<HistoryView> {
  const supabase = await createClient();
  const timeZone = await readTimezone();

  const to = localDay(timeZone);
  const from = addDays(to, -(days - 1));

  const { data, error } = await supabase
    .from('drill_attempts')
    .select('created_at, grade, ev_loss, skill_tags')
    // A day either side, then trimmed exactly by `accuracyOverTime`'s window.
    .gte('created_at', `${addDays(from, -1)}T00:00:00.000Z`)
    .order('created_at', { ascending: true })
    // Thirty days bounds this in practice; the limit bounds it in principle.
    // Someone drilling hard for a month is a good problem, not a reason for the
    // page to fetch without a ceiling.
    .limit(HISTORY_ATTEMPT_LIMIT);

  if (error) throw new Error(`could not load your history: ${error.message}`);

  const attempts: HistoryAttempt[] = (data ?? []).map((row) => ({
    day: localDay(timeZone, new Date(String(row.created_at))),
    tier: row.grade as GradeTier,
    evLoss: Number(row.ev_loss ?? 0),
    skillTags: (row.skill_tags ?? []) as string[],
  }));

  return { points: accuracyOverTime(attempts, { from, to }), from, to };
}
