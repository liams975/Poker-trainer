/**
 * Grading the decisions a person made inside a hand they played.
 *
 * **Graded where a chart reaches, reported everywhere else.** That is narrower
 * than "preflop is graded" and the narrowness is deliberate: the seeded content
 * is ten charts — RFI for five seats and big-blind defence against five single
 * openers — so hero is in charted territory only when first in, or defending
 * the blind against exactly one open. A hand played to the river passes through
 * a dozen spots and at most one of them can be marked.
 *
 * The alternative is the thing this codebase has refused since Phase 3.
 * `heuristics.ts` shipped no decision-making strategy for four phases because
 * "a crude postflop strategy would be able to *grade* a user, and grading
 * someone against invented postflop logic teaches wrong play", and 12a built one
 * for the bot only, on that promise. An uncharted spot that quietly acquired a
 * tier would break it while looking identical to a charted one — so uncharted
 * spots carry a **reason** instead, and the UI says so out loud.
 *
 * ## Why this takes plain data
 *
 * `tests/grading-isolation.test.ts` forbids anything in `drills/` from importing
 * `bot/`, "because the day it imports one is the day a drill could be graded
 * against a sampled bot action instead of against a chart". Recovering the state
 * hero faced at each decision needs `bot/replayHand`. So the recovery happens on
 * the caller's side and this takes the results as data — which keeps the guard
 * structural rather than something a future edit could argue its way past.
 */

import type { BettingAction, HandState, Street } from '../game';
import { potSize } from '../game';
import type { ActionFreq, ChartRegistry, Position } from '../ranges';
import { chartRecommendation } from '../strategy';
import type { Rationale } from '../strategy';

import type { Grade } from './grade';
import { gradeAnswer } from './grade';

/** Why a decision carries no tier. Never absent when `grade` is. */
export type UnchartedReason =
  /** No chart family covers postflop, by construction. */
  | 'postflop'
  /** A real preflop spot that nobody has authored a chart for yet. */
  | 'no-chart';

export interface HeroDecision {
  street: Street;
  position: Position;
  action: BettingAction;
  /** The pot before the action, so a report can show what was at stake. */
  pot: number;
  /** Present only where a chart covers the spot. */
  grade?: Grade;
  /** The mix hero was graded against. Present exactly when `grade` is. */
  frequencies?: readonly ActionFreq[];
  rationale?: Rationale;
  /** Present exactly when `grade` is absent. */
  uncharted?: UnchartedReason;
}

/** One thing a person did, and the spot they did it in. */
export interface ReviewedDecision {
  /** The state hero faced, **before** they acted. */
  state: HandState;
  action: BettingAction;
}

export interface ReviewDecisionsOptions {
  registry: ChartRegistry;
  chartVersion: string;
}

export function reviewHandDecisions(
  decisions: readonly ReviewedDecision[],
  options: ReviewDecisionsOptions,
): readonly HeroDecision[] {
  return decisions.map(({ state, action }) => {
    const base = {
      street: action.street,
      position: action.position,
      action,
      pot: potSize(state),
    };

    // Street first, so postflop gets the reason that is actually true of it
    // rather than "nobody authored this chart" — nobody is going to.
    if (state.street !== 'preflop') {
      return { ...base, uncharted: 'postflop' as const };
    }

    const recommendation = chartRecommendation(state, action.position, options);
    if (recommendation === undefined) {
      return { ...base, uncharted: 'no-chart' as const };
    }

    return {
      ...base,
      grade: gradeAnswer(
        recommendation.frequencies,
        { action: action.action, ...(action.size === undefined ? {} : { size: action.size }) },
        potSize(state),
      ),
      frequencies: recommendation.frequencies,
      rationale: recommendation.rationale,
    };
  });
}
