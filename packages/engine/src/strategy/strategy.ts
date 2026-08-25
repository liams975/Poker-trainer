/**
 * The v2 seam.
 *
 * docs/01-architecture.md: "A drill calls `recommend()` and compares it to the
 * user's answer. A v2 bot calls `recommend()` and samples an action from the
 * distribution. *Same function.* This is the seam that makes bot play cheap
 * later — the strategy layer is already written and tested by the time you
 * need it."
 *
 * Which is why `frequencies` is the payload and `primary` is only for display.
 * Anything that consumed `primary` as "the answer" would be reintroducing the
 * single-right-action model this codebase exists to reject.
 */

import type { Action, ActionFreq, Position } from '../ranges';
import type { HandState } from '../game';

import type { Rationale } from './rationale';

export type StrategySource = 'chart' | 'heuristic';

export interface ActionRecommendation {
  /** The full mixed strategy. This is the answer; `primary` is presentation. */
  frequencies: readonly ActionFreq[];
  /** Highest-frequency action, for display. Ties broken deterministically. */
  primary: Action;
  /** Size of the primary action, when it carries one. */
  primarySize?: number;
  rationale: Rationale;
  source: StrategySource;
  /** Recorded on every `drill_attempt` so old attempts stay interpretable. */
  chartVersion: string;
}

export interface Strategy {
  /**
   * `hero` is a position rather than a `Seat` — docs/03 writes `Seat`, but a
   * position uniquely identifies a seat in 6-max and the seat is already
   * reachable through `state.seats`, so passing both would be redundant.
   */
  recommend(state: HandState, hero: Position): ActionRecommendation;
}
