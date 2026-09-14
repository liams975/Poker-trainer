import { describe, expect, it } from 'vitest';

import {
  MASTERY_LEVELS,
  MASTERY_THRESHOLDS,
  MASTERY_WINDOW,
  type MasteryAttempt,
  masteryFor,
  totalMasteryLevels,
} from '../src/progress/mastery';
import { RANK_TIERS } from '../src/progress/rank';

/**
 * From the deck, 2g: *"Ten skills, five levels each. A level needs 30 graded
 * answers with EV lost under the level's threshold — so a level cannot be
 * ground out by volume alone, and it can drop back."*
 *
 * Two claims worth separating, because only one of them is obvious. "Cannot be
 * ground out by volume" is the interesting one: the gate is an *average* over a
 * trailing window, so playing more spots badly never raises a level. A naive
 * implementation counting qualifying answers would let it.
 */

function attempts(evLosses: readonly number[]): readonly MasteryAttempt[] {
  return evLosses.map((evLoss) => ({ evLoss }));
}

function flat(count: number, evLoss: number): readonly MasteryAttempt[] {
  return attempts(Array.from({ length: count }, () => evLoss));
}

describe('the shape of the ladder', () => {
  it('has five attainable levels above the locked state', () => {
    expect(MASTERY_LEVELS).toBe(5);
  });

  it('needs 30 graded answers, as the deck states', () => {
    expect(MASTERY_WINDOW).toBe(30);
  });

  it('carries one threshold per attainable level', () => {
    expect(MASTERY_THRESHOLDS).toHaveLength(MASTERY_LEVELS);
  });

  it('gets harder at every step', () => {
    for (let i = 1; i < MASTERY_THRESHOLDS.length; i += 1) {
      expect(MASTERY_THRESHOLDS[i]!).toBeLessThan(MASTERY_THRESHOLDS[i - 1]!);
    }
  });

  it('shares its scale with the rank ladder', () => {
    /**
     * L1–L4 are the four rank thresholds, so "L3 in a skill" means "you play
     * that skill to Crusher standard". Two scales measuring EV loss with
     * different boundaries would be two answers to one question.
     */
    const rankThresholds = RANK_TIERS.map((tier) => tier.threshold).filter(
      (threshold): threshold is number => threshold !== undefined,
    );

    expect(MASTERY_THRESHOLDS.slice(0, rankThresholds.length)).toEqual(rankThresholds);
  });
});

describe('a skill starts locked', () => {
  it('is L0 with no attempts at all', () => {
    expect(masteryFor([])).toMatchObject({ level: 0, locked: true });
  });

  it('stays L0 below the window, however good the answers are', () => {
    expect(masteryFor(flat(MASTERY_WINDOW - 1, 0)).level).toBe(0);
  });

  it('reports no accuracy figure when there is nothing to report', () => {
    expect(masteryFor([]).attempts).toBe(0);
  });
});

describe('a level is earned by playing well, not by playing a lot', () => {
  it('awards L1 at the window with a qualifying average', () => {
    expect(masteryFor(flat(MASTERY_WINDOW, 0.5)).level).toBe(1);
  });

  it('cannot be ground out by volume', () => {
    /**
     * The regression this exists for. A thousand answers at an average the
     * ladder does not accept is still L0 — because the gate is the mean of the
     * window, not a count of qualifying attempts.
     */
    expect(masteryFor(flat(1000, 0.9)).level).toBe(0);
  });

  it('climbs as the average falls', () => {
    const levels = [0.9, 0.5, 0.41, 0.29, 0.19, 0.05].map((ev) => masteryFor(flat(60, ev)).level);
    expect(levels).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('caps at L5', () => {
    expect(masteryFor(flat(MASTERY_WINDOW, 0)).level).toBe(MASTERY_LEVELS);
  });
});

describe('a level can drop back', () => {
  it('falls when the recent window worsens', () => {
    const history = [...flat(200, 0.02), ...flat(MASTERY_WINDOW, 0.9)];

    expect(masteryFor(history).level).toBe(0);
  });

  it('reads the window from the end', () => {
    const history = [...flat(200, 0.9), ...flat(MASTERY_WINDOW, 0.02)];

    expect(masteryFor(history).level).toBe(MASTERY_LEVELS);
  });
});

describe('what it takes to climb', () => {
  it('names the next level and its threshold', () => {
    const mastery = masteryFor(flat(MASTERY_WINDOW, 0.5));

    expect(mastery).toMatchObject({ level: 1, next: { level: 2, evLossPerSpot: 0.42 } });
  });

  it('has nothing above L5', () => {
    expect(masteryFor(flat(MASTERY_WINDOW, 0)).next).toBeUndefined();
  });

  it('points a locked skill at L1', () => {
    expect(masteryFor(flat(MASTERY_WINDOW, 5)).next?.level).toBe(1);
  });
});

describe('totalMasteryLevels', () => {
  it('sums levels across skills, for "29 of 50 levels"', () => {
    const ten = Array.from({ length: 10 }, () => flat(MASTERY_WINDOW, 0.5));

    expect(totalMasteryLevels(ten)).toBe(10);
  });

  it('is zero when nothing is unlocked', () => {
    expect(totalMasteryLevels([[], []])).toBe(0);
  });
});
