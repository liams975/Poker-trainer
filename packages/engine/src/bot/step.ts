/**
 * A hand, advanced one step at a time.
 *
 * 12a split dealing and acting into primitives "because 12b needs to stop at
 * hero's turn and hand control to a human". This is that stopping point, and
 * everything that runs a hand goes through it: `playHand` loops on `stepHand`,
 * and so does the table on screen.
 *
 * **One loop, two drivers** is the whole point of the file. A second,
 * UI-shaped loop written beside `playHand` would leave the 100,000-hand
 * conservation proof covering a sibling of the code the app actually runs, and
 * the two would drift the way `strategy/explain.ts` describes: "that is a
 * second implementation of the thing the drill does, and when they drift, the
 * study tool teaches one explanation and the trainer marks against another".
 * The simulation and the screen differ by one option — `human` — and nothing
 * else.
 */

import type { Card } from '../cards';
import type { BettingAction, HandState } from '../game';
import { applyAction, boardCardsNeeded, dealStreet, legalActions } from '../game';
import type { Position } from '../ranges';
import type { Rng } from '../rng';
import type { Strategy } from '../strategy';

import { sampleAction } from './act';

/**
 * A hand in progress: the state, and the cards still to come.
 *
 * The deck travels beside the state rather than inside it. `HandState` is what
 * every seat can see, and a state carrying the undealt deck would make it
 * trivially possible to hand the future to a strategy by accident.
 */
export interface HandProgress {
  state: HandState;
  deck: readonly Card[];
}

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

/**
 * What one step did.
 *
 * Dealing is a step of its own rather than something folded into the action
 * that closed the street, because on screen those are two separate moments: a
 * bet lands, then the cards turn over.
 *
 * `hero` and `complete` **do not advance**. They return the progress they were
 * given, unchanged and by identity, so a caller can tell that nothing happened
 * without comparing states. A loop that does not handle them spins; `playHand`
 * breaks on `complete` and never sees `hero`, and the UI stops on both.
 */
export type Step =
  | { kind: 'deal'; progress: HandProgress }
  | { kind: 'acted'; progress: HandProgress; position: Position; action: BettingAction }
  | { kind: 'hero'; progress: HandProgress }
  | { kind: 'complete'; progress: HandProgress };

/**
 * A hard cap on steps in one hand, for every loop over `stepHand`.
 *
 * Stacks are finite and the betting rules cap raises, so a hand terminates on
 * its own. This exists so that if it ever does not, the simulation fails loudly
 * instead of hanging CI for twenty minutes.
 */
export const MAX_STEPS = 200;

export interface StepOptions {
  rng: Rng;
  /** The strategy a given seat plays. Called once per decision. */
  strategyFor: (position: Position) => Strategy;
  /**
   * The seat a person is playing, if any.
   *
   * Absent is the simulation's case: every seat is a strategy and `hero` never
   * occurs, which is what lets one loop serve both.
   */
  human?: Position | undefined;
}

export function stepHand(progress: HandProgress, options: StepOptions): Step {
  // Board first, always. On an all-in run-out the hand is already over —
  // `toAct` is undefined — and the cards still have to come out.
  if (boardCardsNeeded(progress.state) > 0) {
    return { kind: 'deal', progress: advanceHand(progress) };
  }

  const toAct = progress.state.toAct;
  if (toAct === undefined) return { kind: 'complete', progress };
  if (toAct === options.human) return { kind: 'hero', progress };

  const legal = legalActions(progress.state);
  const recommendation = options.strategyFor(toAct).recommend(progress.state, toAct);
  const answer = sampleAction(recommendation, legal, options.rng);
  const next = actInHand(progress, answer.action, answer.size);

  return {
    kind: 'acted',
    progress: next,
    position: toAct,
    // Read back off the history rather than assembled from `answer`, so what a
    // caller animates is what the engine recorded — including the size
    // `applyAction` settled on, which for an all-in is not what was asked for.
    action: next.state.history[next.state.history.length - 1]!,
  };
}
