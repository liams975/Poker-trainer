/**
 * Grading an answer against a mixed strategy.
 *
 * docs/03-poker-engine.md is emphatic that this is where naive implementations
 * go wrong: "Because ranges are mixed, grading is **not** binary." A hand that
 * opens 70% and folds 30% has two defensible answers, and calling the fold
 * "wrong" teaches the single-right-action model this product exists to correct.
 *
 * Two consequences the tiers encode, both non-negotiable:
 *   - Always show the full distribution after answering, so `Grade` carries it.
 *   - Score by EV loss, not accuracy, so a blunder in a big pot costs more than
 *     a marginal frequency error.
 */

import type { Action, ActionFreq } from '../ranges';
import { FREQ_TOLERANCE, SIZED_ACTIONS, frequencyOf, frequencySum, primaryAction } from '../ranges';

/** The `grade_tier` enum, best to worst. */
export const GRADE_TIERS = ['optimal', 'acceptable', 'inaccurate', 'blunder'] as const;

export type GradeTier = (typeof GRADE_TIERS)[number];

/**
 * At or above this frequency an action is a real part of the strategy, not a
 * rounding artefact. The boundary is inclusive: exactly 0.15 is acceptable.
 */
export const ACCEPTABLE_THRESHOLD = 0.15;

/**
 * How much of the pot a completely wrong sizing costs, relative to picking the
 * wrong action outright. A documented heuristic for teaching emphasis, not a
 * claim about real chip EV — that arrives when postflop does.
 */
export const SIZE_PENALTY_WEIGHT = 0.1;

export interface Answer {
  action: Action;
  /** Required for `bet` and `raise`; forbidden otherwise. In big blinds. */
  size?: number;
}

export interface SizeMismatch {
  chose: number;
  /** The size of the highest-frequency entry for that action. */
  expected: number;
}

/**
 * Three places this deliberately stays loose, pinned here because a UI will
 * otherwise assume them away:
 *
 *   - `primary` can disagree with `tier`. The tier compares summed frequencies;
 *     `primary` is `primaryAction`'s deterministic tiebreak over single entries.
 *     On a 50/50 hand a fold grades `optimal` while `primary` reads `raise`.
 *     **`tier` is the judgement. `primary` is only "what to show as the
 *     headline".** Never render `primary` as "the right answer".
 *   - `tier === 'optimal'` does not imply `evLoss === 0`, because the sizing
 *     term applies regardless of tier: a right action at a wrong size is still
 *     optimal, and still leaks a little.
 *   - `sizeMismatch.expected` and `primarySize` can name different sizes when
 *     two sizes tie on frequency. `expected` is the one for the action the user
 *     actually chose, so it is the one to show next to their answer.
 */
export interface Grade {
  tier: GradeTier;
  /** The chosen action's total frequency, summed across sizes. */
  frequency: number;
  /** The highest frequency any action reaches. */
  bestFrequency: number;
  primary: Action;
  primarySize?: number;
  /** In big blinds, never negative, four decimals. */
  evLoss: number;
  /** Present only when the action was right and the size was not. */
  sizeMismatch?: SizeMismatch;
  /** Echoed back because the mix is the lesson. */
  frequencies: readonly ActionFreq[];
}

const SIZE_TOLERANCE = 0.001;

function checkAnswer(answer: Answer): void {
  const needsSize = SIZED_ACTIONS.includes(answer.action);

  if (needsSize && answer.size === undefined) {
    throw new RangeError(`a ${answer.action} answer needs a size, in big blinds`);
  }
  if (!needsSize && answer.size !== undefined) {
    throw new RangeError(`a ${answer.action} answer cannot carry a size`);
  }
  if (answer.size !== undefined && (!Number.isFinite(answer.size) || answer.size <= 0)) {
    throw new RangeError(`size must be a positive number, got ${answer.size}`);
  }
}

function tierFor(chosen: number, best: number): GradeTier {
  // Compared against the best *frequency*, not against a deterministic
  // tiebreak: a genuine 50/50 hand has two optimal actions, and demoting one of
  // them to "acceptable" would be a lie about the strategy.
  if (chosen > 0 && chosen >= best - FREQ_TOLERANCE) return 'optimal';
  if (chosen >= ACCEPTABLE_THRESHOLD) return 'acceptable';
  if (chosen > 0) return 'inaccurate';
  return 'blunder';
}

function sizeMismatchFor(
  frequencies: readonly ActionFreq[],
  answer: Answer,
): SizeMismatch | undefined {
  if (answer.size === undefined) return undefined;

  const forAction = frequencies.filter((entry) => entry.action === answer.action);
  if (forAction.length === 0) return undefined;

  const matches = forAction.some(
    (entry) => entry.size !== undefined && Math.abs(entry.size - answer.size!) < SIZE_TOLERANCE,
  );
  if (matches) return undefined;

  const expected = forAction.reduce((best, entry) => (entry.freq > best.freq ? entry : best));
  if (expected.size === undefined) return undefined;

  return { chose: answer.size, expected: expected.size };
}

export function gradeAnswer(
  frequencies: readonly ActionFreq[],
  answer: Answer,
  pot: number,
): Grade {
  if (frequencies.length === 0) {
    throw new RangeError('cannot grade against an empty distribution');
  }
  // Finiteness is checked separately because NaN defeats the comparison rather
  // than failing it: `Math.abs(NaN - 1) > FREQ_TOLERANCE` is false, so a
  // malformed distribution would sail through the guard that exists to catch it
  // and produce `evLoss: NaN`, which JSON-serialises to null into a
  // `numeric(8,4)` column. Not reachable from a validated chart — JSON has no
  // NaN literal — but `gradeAnswer` is public API.
  const sum = frequencySum(frequencies);
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > FREQ_TOLERANCE) {
    throw new RangeError(
      `distribution sums to ${Number.isFinite(sum) ? sum.toFixed(4) : String(sum)}, expected 1.0`,
    );
  }
  if (!Number.isFinite(pot) || pot <= 0) {
    throw new RangeError(`pot must be positive, got ${pot}`);
  }
  checkAnswer(answer);

  const chosen = frequencyOf(frequencies, answer.action);
  const actions = new Set(frequencies.map((entry) => entry.action));
  const best = [...actions].reduce(
    (highest, action) => Math.max(highest, frequencyOf(frequencies, action)),
    0,
  );

  const mismatch = chosen > 0 ? sizeMismatchFor(frequencies, answer) : undefined;

  let loss = (best - chosen) * pot;
  if (mismatch !== undefined) {
    const error = Math.min(1, Math.abs(mismatch.chose - mismatch.expected) / mismatch.expected);
    loss += error * SIZE_PENALTY_WEIGHT * pot;
  }

  const top = primaryAction(frequencies);

  return {
    tier: tierFor(chosen, best),
    frequency: chosen,
    bestFrequency: best,
    primary: top.action,
    ...(top.size !== undefined ? { primarySize: top.size } : {}),
    evLoss: Math.max(0, Math.round(loss * 10_000) / 10_000),
    ...(mismatch !== undefined ? { sizeMismatch: mismatch } : {}),
    frequencies,
  };
}
