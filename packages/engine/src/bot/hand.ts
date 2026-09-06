/**
 * Running a hand from the deal to the award, with nobody to wait for.
 *
 * The loop itself lives in `step.ts`. This is the closed form: every seat is a
 * strategy, hero included, which is exactly what makes headless simulation
 * possible — a hand nobody has to click through can be run a hundred thousand
 * times in a test.
 */

import type { BettingAction, HandConfig, HandResult, HandState } from '../game';
import { dealHand, settleHand } from '../game';
import type { Action, Position } from '../ranges';
import type { Rng } from '../rng';
import type { Strategy } from '../strategy';

import type { HandProgress } from './step';
import { MAX_STEPS, actInHand, stepHand } from './step';

export interface PlayedHand {
  final: HandState;
  result: HandResult;
  /** Every action taken, in order. `state.history` without the street noise. */
  actions: readonly BettingAction[];
}

export interface PlayHandOptions {
  rng: Rng;
  /** The strategy each seat plays. Called once per decision. */
  strategyFor: (position: Position) => Strategy;
  config?: HandConfig;
}

export function playHand(options: PlayHandOptions): PlayedHand {
  const { rng, strategyFor, config = {} } = options;

  let progress: HandProgress = dealHand(rng, config);

  for (let step = 0; ; step++) {
    if (step > MAX_STEPS) {
      throw new RangeError(`a hand took more than ${MAX_STEPS} steps; it is not terminating`);
    }

    // No `human`, so `stepHand` never yields `hero` and this loop never stalls.
    const taken = stepHand(progress, { rng, strategyFor });
    progress = taken.progress;

    if (taken.kind === 'complete') break;
  }

  const { state: final, result } = settleHand(progress.state);

  return { final, result, actions: progress.state.history };
}

/** One thing a person did, and the spot they did it in. */
export interface HeroDecisionPoint {
  /** The state hero faced, **before** they acted. A chart lookup needs this. */
  state: HandState;
  /** What they did, as the engine recorded it. */
  action: BettingAction;
}

export interface ReplayHandOptions extends PlayHandOptions {
  /** The seat a person played. */
  human: Position;
  /** Their actions, in the order they took them. */
  humanActions: readonly { action: Action; size?: number }[];
}

export interface ReplayedHand extends PlayedHand {
  decisions: readonly HeroDecisionPoint[];
}

/**
 * Replays a hand a person played, from the seed and their actions alone.
 *
 * The opponents are **reproduced, not stored**. Same seed, same strategies,
 * same order of draws — so a whole hand of six players compresses to a number
 * and a handful of actions, which is what makes a hand history cheap to keep
 * and exactly reconstructible later.
 *
 * Two callers want this and they want it for the same reason. The server
 * replays what a browser claims happened and writes the result *it* derives, so
 * a client cannot post a hand it did not play. Post-hand review replays to
 * recover the state hero faced at each decision, because grading a spot needs
 * the spot and not just the action taken in it.
 *
 * It throws on any disagreement — too few actions, too many, or one the rules
 * reject. That is the point: a claim that does not replay is a claim to refuse,
 * not to repair.
 */
export function replayHand(options: ReplayHandOptions): ReplayedHand {
  const { rng, strategyFor, config = {}, human, humanActions } = options;

  let progress: HandProgress = dealHand(rng, config);
  const decisions: HeroDecisionPoint[] = [];
  let taken = 0;

  for (let step = 0; ; step++) {
    if (step > MAX_STEPS) {
      throw new RangeError(`a hand took more than ${MAX_STEPS} steps; it is not terminating`);
    }

    const result = stepHand(progress, { rng, strategyFor, human });

    if (result.kind === 'complete') {
      if (taken < humanActions.length) {
        throw new RangeError(
          `the hand ended with ${humanActions.length - taken} of ${human}'s actions unused`,
        );
      }
      progress = result.progress;
      break;
    }

    if (result.kind !== 'hero') {
      progress = result.progress;
      continue;
    }

    const next = humanActions[taken];
    if (next === undefined) {
      throw new RangeError(
        `the replay reached ${human}'s turn ${taken + 1} times but was given ${humanActions.length} actions`,
      );
    }
    taken++;

    const before = result.progress.state;
    progress = actInHand(result.progress, next.action, next.size);
    decisions.push({
      state: before,
      action: progress.state.history[progress.state.history.length - 1]!,
    });
  }

  const { state: final, result } = settleHand(progress.state);

  return { final, result, actions: progress.state.history, decisions };
}
