import type { Action, Position, Strategy } from '@poker/engine';
import { createBotStrategy, mulberry32, profileById } from '@poker/engine';
import type { ChartRegistry } from '@poker/engine';

/**
 * What the browser and the server both need, and neither owns.
 *
 * A types-only module in the sense CLAUDE.md means: **it imports nothing from a
 * server module.** "Never import a *value* from a server module into a client
 * component. A `import type` is erased and safe; one value import beside it
 * drags `next/headers` into the browser bundle and 500s the route. This has
 * bitten twice." Everything here is either a shape or a pure function over
 * `@poker/engine`, which has no environment at all.
 *
 * The one function is here rather than duplicated on each side on purpose. The
 * server replays a hand the browser already played and writes the result *it*
 * derives; that only works if both build the opponents identically, down to the
 * trial count, because every Monte Carlo trial is a draw from the same seeded
 * rng and a different count desynchronises the whole hand.
 */

/**
 * Monte Carlo trials per bot decision, fixed for both sides.
 *
 * **Changing this changes every stored hand's replay.** It is a rng-consumption
 * count, not a tuning knob — a hand recorded at 200 will not reproduce at 240.
 * If it ever has to move, it moves with `BOT_ENGINE_VERSION` and old hands stay
 * interpretable by the version they were played at.
 *
 * 200 is the engine's own default. Measured shape: it is 200 trials *total*,
 * not per villain hand, so a decision costs milliseconds and there was never a
 * case for moving this off the main thread.
 */
export const BOT_TRIALS = 200;

/** Bumped whenever bot decisions change shape, so a stale replay is visible. */
export const BOT_ENGINE_VERSION = '12b.1';

/** The six seats, and which opponent is in each. Hero's carries no profile. */
export type SeatProfiles = Partial<Record<Position, string>>;

/** One thing hero did. The bots' actions are reproduced, never sent. */
export interface HeroAction {
  action: Action;
  size?: number;
}

/**
 * A hand the browser claims to have played.
 *
 * Deliberately the *inputs* and nothing else: no board, no opponents' actions,
 * no result. Everything downstream of the deal is derived by the server, so
 * there is nothing here for a client to be believed about.
 */
export interface BotHandClaim {
  sessionId: string;
  handNo: number;
  seed: number;
  button: number;
  heroPosition: Position;
  /** Stacks at the deal, by position — the table carries them between hands. */
  stacks: Partial<Record<Position, number>>;
  profiles: SeatProfiles;
  heroActions: readonly HeroAction[];
}

export interface RecordedBotHand {
  handId: string;
  /** Hero's result for the hand, in big blinds. Negative is a loss. */
  heroNet: number;
}

export interface BotStrategyContext {
  registry: ChartRegistry;
  chartVersion: string;
  seed: number;
}

/**
 * The opponents, built the same way on both sides of the wire.
 *
 * One rng for the whole hand, created from the hand's own seed: the deal and
 * every bot decision draw from it in order, which is what makes a hand
 * reproducible from a single number.
 */
export function botStrategies(
  profiles: SeatProfiles,
  context: BotStrategyContext,
): { rng: ReturnType<typeof mulberry32>; strategyFor: (position: Position) => Strategy } {
  const rng = mulberry32(context.seed);
  const built = new Map<Position, Strategy>();

  return {
    rng,
    strategyFor(position: Position): Strategy {
      const existing = built.get(position);
      if (existing !== undefined) return existing;

      const profile = profileById(profiles[position] ?? 'balanced');
      const strategy = createBotStrategy({
        registry: context.registry,
        chartVersion: context.chartVersion,
        rng,
        trials: BOT_TRIALS,
        aggression: profile.aggression,
        looseness: profile.looseness,
      });

      built.set(position, strategy);
      return strategy;
    },
  };
}
