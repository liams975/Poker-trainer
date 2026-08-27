import type {
  Action,
  ActionFreq,
  DrillScenario,
  Grade,
  GradeTier,
  Rationale,
} from '@poker/engine';
import {
  createChartStrategy,
  gradeAnswer,
  isPosition,
  potSize,
  rebuildSpot,
  skillTagsFor,
} from '@poker/engine';

import { getCharts } from '@/lib/charts/registry';
import { createClient } from '@/lib/supabase/server';

/**
 * Writing a drill session.
 *
 * Reached through Route Handlers (`app/api/drill/*`), **not** Server Actions.
 * That is not a style choice: Next serialises Server Actions through the
 * router's queue, and dispatching a second one while the first is in flight
 * drops it. A drill answers faster than a round trip completes, so the queue
 * silently swallowed roughly half of every session's attempts — measured, in
 * the e2e run that caught it: 6 of 10 recorded, no error anywhere. Plain
 * `fetch` to a route handler has no such queue and the requests are
 * independent.
 *
 * **The client never decides what is stored.** The browser grades locally so
 * the tier lands without a spinner — docs/05 puts the feedback moment under
 * 100ms — but `recordAttempt` independently rebuilds the spot from its
 * scenario, re-derives the recommendation from the server's own chart registry,
 * and grades it again. The row is written from the server's result.
 *
 * That matters more here than anywhere else in the app: `drill_attempts` is
 * append-only, and docs/04 makes `skill_stats`, `review_queue` and every future
 * progress figure derived from it. A client that can post its own grades can
 * manufacture a history that all of those then faithfully reproduce.
 *
 * Contrast `xp_events`, which docs/04 deliberately leaves honour-system. The
 * difference is that XP is cosmetic and this is the record everything else is
 * recomputed from.
 */

// Mirrors the `drill_mode` enum. `placement` was added in migration 0003 so
// Phase 9 can keep a diagnostic out of accuracy stats, as it does for `study`.
const SESSION_MODES = [
  'quick',
  'focused',
  'weak_spots',
  'lesson',
  'study',
  'placement',
] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_MS = 86_400_000;
const MAX_UINT32 = 4_294_967_295;

function fail(message: string): never {
  throw new Error(message);
}

function uuid(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) fail(`${name} must be a uuid`);
  return value;
}

/**
 * Shape only. The semantic check — that the scenario describes a spot that
 * actually replays to hero facing what it claims — is `rebuildSpot`'s, which
 * already refuses a contradictory descriptor rather than replaying it into a
 * plausible-but-wrong state (packages/engine/src/drills/generate.ts).
 */
function parseScenario(value: unknown): DrillScenario {
  if (typeof value !== 'object' || value === null) fail('scenario must be an object');
  const raw = value as Record<string, unknown>;

  if (typeof raw.templateSlug !== 'string') fail('scenario.templateSlug must be a string');
  if (!isPosition(raw.heroPosition)) fail('scenario.heroPosition is not a 6-max position');
  if (typeof raw.actionSequence !== 'string') fail('scenario.actionSequence must be a string');
  if (typeof raw.hand !== 'string') fail('scenario.hand must be a string');
  if (
    !Array.isArray(raw.hole) ||
    raw.hole.length !== 2 ||
    !raw.hole.every((card) => typeof card === 'string')
  ) {
    fail('scenario.hole must be two cards');
  }
  if (typeof raw.tableSize !== 'number' || typeof raw.stackDepth !== 'number') {
    fail('scenario needs a numeric tableSize and stackDepth');
  }
  if (raw.openSize !== undefined && typeof raw.openSize !== 'number') {
    fail('scenario.openSize must be a number when present');
  }

  return {
    templateSlug: raw.templateSlug,
    heroPosition: raw.heroPosition,
    actionSequence: raw.actionSequence,
    hand: raw.hand as DrillScenario['hand'],
    hole: [raw.hole[0] as string, raw.hole[1] as string],
    ...(raw.openSize === undefined ? {} : { openSize: raw.openSize }),
    tableSize: raw.tableSize,
    stackDepth: raw.stackDepth,
  };
}

export interface StartSessionInput {
  mode: SessionMode;
  seed: number;
  spotsPlanned: number | null;
  templateSlugs: readonly string[];
}

export interface StartedSession {
  sessionId: string;
}

export async function startSession(
  userId: string,
  input: StartSessionInput,
): Promise<StartedSession> {
  const supabase = await createClient();

  if (!SESSION_MODES.includes(input.mode)) fail(`unknown drill mode ${input.mode}`);
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > MAX_UINT32) {
    fail('session seed must fit in a uint32');
  }

  const { data, error } = await supabase
    .from('drill_sessions')
    .insert({
      user_id: userId,
      mode: input.mode,
      // The seed lives here so the whole session replays from one number, and
      // the filters so a focused session stays interpretable later.
      config: { seed: input.seed, templateSlugs: input.templateSlugs },
      spots_planned: input.spotsPlanned,
    })
    .select('id')
    .single();

  if (error) fail(`could not start the session: ${error.message}`);

  return { sessionId: data.id as string };
}

export interface RecordAttemptInput {
  sessionId: string;
  templateId: string;
  scenario: unknown;
  seed: number;
  action: Action;
  size?: number | undefined;
  responseMs: number;
  /** What the browser graded it. Compared, never trusted, never stored. */
  clientTier?: GradeTier | undefined;
}

export interface RecordedAttempt {
  grade: Grade;
  frequencies: readonly ActionFreq[];
  rationale: Rationale;
  chartVersion: string;
  skillTags: readonly string[];
}

export async function recordAttempt(
  userId: string,
  input: RecordAttemptInput,
): Promise<RecordedAttempt> {
  const supabase = await createClient();

  const sessionId = uuid(input.sessionId, 'sessionId');
  const templateId = uuid(input.templateId, 'templateId');
  const scenario = parseScenario(input.scenario);

  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > MAX_UINT32) {
    fail('seed must fit in a uint32');
  }
  if (
    !Number.isFinite(input.responseMs) ||
    input.responseMs < 0 ||
    input.responseMs > MAX_RESPONSE_MS
  ) {
    fail('responseMs is out of range');
  }

  // Re-derive everything. Nothing the client sent about the *answer's quality*
  // is used — only which action it chose.
  const { chartSet, registry } = await getCharts();
  const spot = rebuildSpot(scenario);
  const strategy = createChartStrategy({ registry, chartVersion: chartSet.version });
  const recommendation = strategy.recommend(spot.state, spot.hero);

  const answer = { action: input.action, ...(input.size === undefined ? {} : { size: input.size }) };
  const grade = gradeAnswer(recommendation.frequencies, answer, potSize(spot.state));
  const skillTags = skillTagsFor(scenario, registry);

  if (input.clientTier !== undefined && input.clientTier !== grade.tier) {
    /**
     * Logged, never acted on. The two run the same engine over the same charts,
     * so a disagreement is either a tampered payload or a real bug in one of
     * the two paths — both worth seeing, neither worth changing behaviour over.
     *
     * Deliberately not a throw, and deliberately not different in development:
     * the stored grade must be the server's in every environment, or the
     * security property holds only where nobody is attacking it. A dev-only
     * rejection would also mean the e2e suite exercises a path production never
     * takes, which is how this kind of divergence stays hidden.
     */
    console.error(
      `drill grade mismatch: client said ${input.clientTier}, server said ${grade.tier} ` +
        `for ${scenario.hand} at ${scenario.heroPosition}/${scenario.actionSequence}`,
    );
  }

  const { error } = await supabase.from('drill_attempts').insert({
    user_id: userId,
    session_id: sessionId,
    template_id: templateId,
    seed: input.seed,
    chart_version: chartSet.version,
    scenario,
    user_action: answer.action,
    user_size: answer.size ?? null,
    primary_action: grade.primary,
    frequencies: recommendation.frequencies,
    grade: grade.tier,
    ev_loss: grade.evLoss,
    response_ms: Math.round(input.responseMs),
    skill_tags: skillTags,
  });

  if (error) fail(`could not record the attempt: ${error.message}`);

  return {
    grade,
    frequencies: recommendation.frequencies,
    rationale: recommendation.rationale,
    chartVersion: chartSet.version,
    skillTags,
  };
}

export async function finishSession(sessionId: string): Promise<void> {
  const supabase = await createClient();

  // No user_id filter: RLS scopes the update to the caller's own rows, and
  // adding one here would suggest the policy were optional.
  const { error } = await supabase
    .from('drill_sessions')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', uuid(sessionId, 'sessionId'));

  if (error) fail(`could not close the session: ${error.message}`);
}
