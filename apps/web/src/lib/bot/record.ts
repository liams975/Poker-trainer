import type { Position } from '@poker/engine';
import { HEURISTIC_VERSION, isPosition, replayHand } from '@poker/engine';

import { getCharts } from '@/lib/charts/registry';
import { createClient } from '@/lib/supabase/server';

import type { BotHandClaim, HeroAction, RecordedBotHand, SeatProfiles } from './types';
import { BOT_ENGINE_VERSION, botStrategies } from './types';

/**
 * Writing a hand of bot play.
 *
 * Reached through Route Handlers (`app/api/bot/*`), **not** Server Actions, for
 * the reason `lib/drills/record.ts` records: Next serialises Server Actions
 * through the router's queue and drops a second one dispatched while the first
 * is in flight. That cost the drill roughly half of every session's attempts,
 * silently, and a hand ends faster than a round trip completes here too.
 *
 * ## The client does not decide what is stored
 *
 * A browser posts the *inputs* — the seed, the seating, the stacks, and its own
 * actions — and nothing downstream of the deal. The server replays the hand
 * with the same engine and writes the actions and the result **it** derives. A
 * client cannot post a hand it did not play, because there is nothing in the
 * payload to be believed about: the board, all five opponents' decisions, the
 * showdown and the payouts are all reproduced from the seed.
 *
 * That property is cheap here and worth having before it is needed. Nothing in
 * 12b pays out for playing — no XP, no streak — but 12c's review recomputes
 * from these rows, and `drill_attempts` is the standing example of why the
 * record everything else derives from has to be the server's.
 *
 * A replay that disagrees is **refused, not repaired.** `replayHand` throws on
 * an action the rules reject, one the hand never needed, or one it needed and
 * did not get; the route turns that into a 409 and the browser says the hand
 * could not be recorded. Play continues either way — losing a row is a much
 * smaller harm than writing a wrong one.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_UINT32 = 4_294_967_295;
const SEATS = 6;
const MAX_HERO_ACTIONS = 40;

function fail(message: string): never {
  throw new Error(message);
}

function uuid(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) fail(`${name} must be a uuid`);
  return value;
}

function stacksOf(value: unknown): Partial<Record<Position, number>> {
  if (typeof value !== 'object' || value === null) fail('stacks must be an object');

  const stacks: Partial<Record<Position, number>> = {};
  for (const [position, stack] of Object.entries(value as Record<string, unknown>)) {
    if (!isPosition(position)) fail(`"${position}" is not a 6-max position`);
    if (typeof stack !== 'number' || !Number.isFinite(stack) || stack < 0) {
      fail(`${position}'s stack must be a non-negative number`);
    }
    stacks[position] = stack;
  }

  if (Object.keys(stacks).length !== SEATS) fail(`a hand seats ${SEATS}, got ${Object.keys(stacks).length}`);

  return stacks;
}

function profilesOf(value: unknown): SeatProfiles {
  if (typeof value !== 'object' || value === null) fail('profiles must be an object');

  const profiles: SeatProfiles = {};
  for (const [position, id] of Object.entries(value as Record<string, unknown>)) {
    if (!isPosition(position)) fail(`"${position}" is not a 6-max position`);
    if (typeof id !== 'string') fail(`${position}'s profile must be a string`);
    profiles[position] = id;
  }

  return profiles;
}

function heroActionsOf(value: unknown): readonly HeroAction[] {
  if (!Array.isArray(value)) fail('heroActions must be an array');
  if (value.length > MAX_HERO_ACTIONS) {
    fail(`a hand cannot hold ${value.length} of hero's actions`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) fail(`heroActions[${index}] must be an object`);
    const raw = entry as Record<string, unknown>;

    if (typeof raw.action !== 'string') fail(`heroActions[${index}].action must be a string`);
    if (raw.size !== undefined && (typeof raw.size !== 'number' || !Number.isFinite(raw.size))) {
      fail(`heroActions[${index}].size must be a number when present`);
    }

    return {
      action: raw.action as HeroAction['action'],
      ...(raw.size === undefined ? {} : { size: raw.size }),
    };
  });
}

export interface StartBotSessionInput {
  stackDepth: number;
  bigBlind: number;
  profiles: SeatProfiles;
}

export async function startBotSession(userId: string, input: StartBotSessionInput) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('bot_sessions')
    .insert({
      user_id: userId,
      config: {
        stackDepth: input.stackDepth,
        bigBlind: input.bigBlind,
        profiles: input.profiles,
        engineVersion: BOT_ENGINE_VERSION,
      },
    })
    .select('id')
    .single();

  if (error) fail(`could not start the session: ${error.message}`);

  return { sessionId: data.id as string };
}

export async function endBotSession(userId: string, sessionId: string): Promise<void> {
  const supabase = await createClient();

  // No ownership filter beyond RLS, which is the point of RLS: the update
  // matches no rows for a session the caller does not own.
  const { error } = await supabase
    .from('bot_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', uuid(sessionId, 'sessionId'))
    .is('ended_at', null);

  if (error) fail(`could not close the session: ${error.message}`);
}

/**
 * Replays the claim and writes what the replay produced.
 *
 * Throws — rather than writing something approximate — whenever the claim does
 * not reproduce. See the file comment.
 */
export async function recordBotHand(
  userId: string,
  input: BotHandClaim,
): Promise<RecordedBotHand> {
  const supabase = await createClient();

  const sessionId = uuid(input.sessionId, 'sessionId');

  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > MAX_UINT32) {
    fail('seed must fit in a uint32');
  }
  if (!Number.isInteger(input.handNo) || input.handNo < 0) fail('handNo must be a whole number');
  if (!Number.isInteger(input.button) || input.button < 0 || input.button >= SEATS) {
    fail(`button must be a seat index below ${SEATS}`);
  }
  if (!isPosition(input.heroPosition)) fail('heroPosition is not a 6-max position');

  const stacks = stacksOf(input.stacks);
  const profiles = profilesOf(input.profiles);
  const heroActions = heroActionsOf(input.heroActions);

  const { chartSet, registry } = await getCharts();

  // Stack depth and the blinds are left to `createHandState`'s own defaults
  // rather than restated here. v1's locked scope is 6-max 100bb; restating it
  // would give the server a second opinion about what a table is, and the two
  // would have to agree forever for a replay to reproduce.
  const config = { tableSize: SEATS, stacks };

  const { rng, strategyFor } = botStrategies(profiles, {
    registry,
    chartVersion: chartSet.version,
    seed: input.seed,
  });

  // Throws on any disagreement. The caller turns that into a 409.
  const replay = replayHand({
    rng,
    strategyFor,
    config,
    human: input.heroPosition,
    humanActions: heroActions,
  });

  const heroPayout = replay.result.payouts.find(
    (payout) => payout.position === input.heroPosition,
  );
  const heroNet = Math.round((heroPayout?.net ?? 0) * 100) / 100;

  const { data, error } = await supabase
    .from('bot_hands')
    .insert({
      user_id: userId,
      session_id: sessionId,
      hand_no: input.handNo,
      seed: input.seed,
      button: input.button,
      hero_position: input.heroPosition,
      stacks,
      // The server's replay, not the client's claim.
      actions: replay.actions,
      result: replay.result,
      hero_net: heroNet,
      chart_version: chartSet.version,
      heuristic_version: HEURISTIC_VERSION,
    })
    .select('id')
    .single();

  if (error) fail(`could not record the hand: ${error.message}`);

  return { handId: data.id as string, heroNet };
}
