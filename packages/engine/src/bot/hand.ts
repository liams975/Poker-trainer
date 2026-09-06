/**
 * Running a hand from the deal to the award.
 *
 * Split into `advanceHand` / `actInHand` rather than written as one loop,
 * because 12b needs to stop at hero's turn and hand control to a human. A
 * closed `playHand(strategies)` would have to be rewritten the moment a person
 * sits down; this one gets driven a step at a time by the UI and all at once by
 * the simulation.
 */

import type { Card } from '../cards';
import type { BettingAction, HandConfig, HandResult, HandState } from '../game';
import {
  applyAction,
  boardCardsNeeded,
  dealHand,
  dealStreet,
  legalActions,
  settleHand,
} from '../game';
import type { Position } from '../ranges';
import type { Rng } from '../rng';
import type { Strategy } from '../strategy';

import { sampleAction } from './act';

/**
 * A hand in progress: the state, and the cards still to come.
 *
 * The deck travels with the state rather than inside it. `HandState` is what
 * every seat can see, and a state carrying the undealt deck would make it
 * trivially possible to hand the future to a strategy by accident.
 */
export interface HandProgress {
  state: HandState;
  deck: readonly Card[];
}

export interface PlayedHand {
  final: HandState;
  result: HandResult;
  /** Every action taken, in order. `state.history` without the street noise. */
  actions: readonly BettingAction[];
}

/**
 * A hard cap on actions in one hand.
 *
 * Stacks are finite and the betting rules cap raises, so a hand terminates on
 * its own. This exists so that if it ever does not, the simulation fails
 * loudly instead of hanging CI for twenty minutes.
 */
const MAX_ACTIONS = 200;

/**
 * Deals whatever board the current street is owed.
 *
 * Note what happens when everyone is all-in: `applyAction` walks the streets
 * out on its own and lands on the river with `toAct` undefined and an empty
 * board, so this deals all five at once rather than three-then-one-then-one.
 * The cards are identical either way — same deck, same order — so `board[0..2]`
 * is still the flop and `board[3]` still the turn. A UI that wants to reveal
 * them one street at a time can slice; nothing is lost by dealing them
 * together here.
 */
export function advanceHand(progress: HandProgress): HandProgress {
  const needed = boardCardsNeeded(progress.state);
  return needed > 0 ? dealStreet(progress.state, progress.deck) : progress;
}

export function actInHand(
  progress: HandProgress,
  action: BettingAction['action'],
  size?: number,
): HandProgress {
  return {
    state: applyAction(progress.state, action, size),
    deck: progress.deck,
  };
}

export interface PlayHandOptions {
  rng: Rng;
  /** The strategy each seat plays. Called once per decision. */
  strategyFor: (position: Position) => Strategy;
  config?: HandConfig;
}

/**
 * Deals a hand and plays it out.
 *
 * Everyone is a strategy, hero included — which is exactly what makes the
 * conservation test possible. A hand nobody has to click through can be run
 * two thousand times in a test.
 */
export function playHand(options: PlayHandOptions): PlayedHand {
  const { rng, strategyFor, config = {} } = options;

  let progress: HandProgress = dealHand(rng, config);

  for (let step = 0; ; step++) {
    if (step > MAX_ACTIONS) {
      throw new RangeError(`a hand took more than ${MAX_ACTIONS} actions; it is not terminating`);
    }

    progress = advanceHand(progress);

    const hero = progress.state.toAct;
    if (hero === undefined) break;

    const legal = legalActions(progress.state);
    const recommendation = strategyFor(hero).recommend(progress.state, hero);
    const answer = sampleAction(recommendation, legal, rng);

    progress = actInHand(progress, answer.action, answer.size);
  }

  const { state: final, result } = settleHand(progress.state);

  return { final, result, actions: progress.state.history };
}
