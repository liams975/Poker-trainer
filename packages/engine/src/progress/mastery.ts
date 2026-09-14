/**
 * Per-skill mastery levels, L0 to L5.
 *
 * From the v2 deck, 2g: *"Ten skills, five levels each. A level needs 30 graded
 * answers with EV lost under the level's threshold — so a level cannot be
 * ground out by volume alone, and it can drop back."*
 *
 * The second half of that sentence is the design. A level is the mean of a
 * trailing window, never a count of qualifying answers, so more volume at a
 * mediocre standard moves nothing. That is the difference between a measure of
 * skill and a measure of attendance — and the app already has a streak for
 * attendance.
 *
 * **Gated on EV loss, displayed with accuracy.** The deck's own mock data pairs
 * each level with an accuracy percentage, but its prose says the gate is EV
 * lost, and docs/03 is unambiguous about which is the real measure: two of the
 * four grade tiers are correct answers to a mixed spot, so accuracy does not
 * describe skill here. Chips do. Accuracy stays a display figure.
 */

import { RANK_TIERS } from './rank';

/** One graded answer on a skill, reduced to what levelling needs. */
export interface MasteryAttempt {
  /** Bigblinds of EV given up on this spot. Never negative. */
  evLoss: number;
}

/** Attainable levels above the locked state. L0 is not one of them. */
export const MASTERY_LEVELS = 5;

/**
 * How many recent answers a level is judged on.
 *
 * Small enough that a skill responds within a session, large enough that one
 * bad spot in a mixed range does not demote anybody. The deck fixes it at 30.
 */
export const MASTERY_WINDOW = 30;

/**
 * Mean EV loss required for each level, L1 first.
 *
 * L1–L4 are exactly the rank ladder's four thresholds, so the two scales agree:
 * "L3 in a skill" means "you play that skill to Crusher standard". Two ladders
 * measuring the same quantity with different boundaries would be two answers to
 * one question, and the one nobody was looking at would drift.
 *
 * L5 continues past the top of the rank ladder, because a skill can be mastered
 * while an overall rank — averaged across every skill, including the weak ones
 * — is still climbing. The deck's own figures show exactly that: skills at L5
 * beside an overall rank of Reg III.
 *
 * The alignment is asserted in `progress-mastery.test.ts`, not just described.
 */
export const MASTERY_THRESHOLDS: readonly number[] = [
  ...RANK_TIERS.map((tier) => tier.threshold).filter(
    (threshold): threshold is number => threshold !== undefined,
  ),
  0.12,
];

export interface NextMastery {
  level: number;
  /** The mean EV loss over the window that reaches it. */
  evLossPerSpot: number;
}

export interface Mastery {
  /** 0–5. Zero means the skill has not been unlocked. */
  level: number;
  /** True at L0, where the UI says what opens the skill rather than showing a score. */
  locked: boolean;
  /** How many answers exist on this skill in total, not just in the window. */
  attempts: number;
  /** Mean EV loss over the window. Zero when the window is not yet full. */
  evLossPerSpot: number;
  /** `undefined` at L5. */
  next?: NextMastery | undefined;
}

/** Matches `drill_attempts.ev_loss numeric(8,4)`. See the note in `rank.ts`. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * The level earned by the most recent `MASTERY_WINDOW` answers on one skill.
 *
 * Attempts are read **oldest-first**, matching `rollUpSkillStats` and `rankFor`;
 * the window is taken from the end.
 *
 * Below a full window the skill stays L0 however good the answers are. That is
 * deliberate rather than incidental: a level awarded on four answers would be
 * withdrawn again on the fifth, and a number that moves both ways for reasons
 * the user cannot see is worse than no number.
 */
export function masteryFor(attempts: readonly MasteryAttempt[]): Mastery {
  const next = (level: number): NextMastery | undefined =>
    level >= MASTERY_LEVELS
      ? undefined
      : { level: level + 1, evLossPerSpot: MASTERY_THRESHOLDS[level]! };

  if (attempts.length < MASTERY_WINDOW) {
    return {
      level: 0,
      locked: true,
      attempts: attempts.length,
      evLossPerSpot: 0,
      next: next(0),
    };
  }

  const recent = attempts.slice(-MASTERY_WINDOW);

  let total = 0;
  for (const attempt of recent) total += attempt.evLoss;
  const average = round4(total / recent.length);

  // The highest level whose threshold the window's mean has reached.
  let level = 0;
  for (let i = MASTERY_THRESHOLDS.length - 1; i >= 0; i -= 1) {
    if (average <= MASTERY_THRESHOLDS[i]!) {
      level = i + 1;
      break;
    }
  }

  return {
    level,
    locked: level === 0,
    attempts: attempts.length,
    evLossPerSpot: average,
    next: next(level),
  };
}

/**
 * Levels earned across every skill — the numerator in "29 of 50 levels".
 *
 * The denominator is `skills.length * MASTERY_LEVELS`, which the caller knows
 * and this does not need to be told.
 */
export function totalMasteryLevels(
  perSkill: readonly (readonly MasteryAttempt[])[],
): number {
  let total = 0;
  for (const attempts of perSkill) total += masteryFor(attempts).level;
  return total;
}
