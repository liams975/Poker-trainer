import { describe, expect, it } from 'vitest';

import type { AchievementCriteria, ProgressSnapshot } from '../src/progress/achievements';
import { achievementProgress, evaluateAchievements } from '../src/progress/achievements';

/**
 * Progress toward a locked achievement — frame 2h.
 *
 * The deck's rule: *"Locked badges say what they need and how far along you are
 * — a badge you cannot see the shape of is not a goal."*
 *
 * The property that matters most is the last one in this file: progress and
 * `evaluateAchievements` must never disagree about whether something is earned.
 * Two functions reading one criteria object is exactly the shape that drifts,
 * and a gallery showing "9/9" beside a locked badge is worse than showing
 * nothing.
 */

function snapshot(overrides: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
  return { spots: 0, streak: 0, lessonsCompleted: 0, stats: [], ...overrides };
}

function stat(attempts: number, ewmaAccuracy: number, skillTag = 'preflop.rfi.btn') {
  return { skillTag, attempts, correct: 0, ewmaAccuracy, avgEvLoss: 0 };
}

describe('the countable kinds read straight off the snapshot', () => {
  it.each([
    [{ kind: 'spots', count: 500 } as AchievementCriteria, snapshot({ spots: 120 }), 120, 500],
    [{ kind: 'streak', days: 7 } as AchievementCriteria, snapshot({ streak: 3 }), 3, 7],
    [
      { kind: 'lessons', count: 10 } as AchievementCriteria,
      snapshot({ lessonsCompleted: 4 }),
      4,
      10,
    ],
  ])('reports current and target', (criteria, state, current, target) => {
    expect(achievementProgress(criteria, state)).toEqual({ current, target });
  });

  it('starts at zero rather than undefined', () => {
    expect(achievementProgress({ kind: 'spots', count: 100 }, snapshot())).toEqual({
      current: 0,
      target: 100,
    });
  });

  it('never reports more than the target, so a bar cannot overflow', () => {
    expect(achievementProgress({ kind: 'spots', count: 100 }, snapshot({ spots: 4000 }))).toEqual({
      current: 100,
      target: 100,
    });
  });
});

describe('mastery needs both bars on one skill', () => {
  const criteria: AchievementCriteria = { kind: 'mastery', accuracy: 0.9, minAttempts: 50 };

  it('counts attempts on a skill that already clears the accuracy bar', () => {
    const state = snapshot({ stats: [stat(30, 0.95)] });
    expect(achievementProgress(criteria, state)).toEqual({ current: 30, target: 50 });
  });

  it('counts a tiny sample toward the attempts bar, which is what that bar is for', () => {
    /**
     * A tag at 100% over two answers is noise, and `met` refuses it — but it
     * refuses it on *attempts*, not by pretending the accuracy did not happen.
     * So 2 of 50 is the honest reading: the bar is barely started, and the
     * thing keeping the badge locked is visible in the number.
     */
    const state = snapshot({ stats: [stat(2, 1)] });
    expect(achievementProgress(criteria, state).current).toBe(2);
  });

  it('ignores skills below the accuracy bar entirely', () => {
    const state = snapshot({ stats: [stat(200, 0.4)] });
    expect(achievementProgress(criteria, state).current).toBe(0);
  });

  it('takes the best skill when several qualify', () => {
    const state = snapshot({
      stats: [stat(10, 0.92, 'a'), stat(44, 0.91, 'b'), stat(30, 0.99, 'c')],
    });
    expect(achievementProgress(criteria, state).current).toBe(44);
  });

  it('is zero with no stats at all', () => {
    expect(achievementProgress(criteria, snapshot()).current).toBe(0);
  });
});

describe('progress and evaluation never disagree', () => {
  /**
   * The invariant that keeps the gallery honest: a badge reads as complete if
   * and only if `evaluateAchievements` would award it. Asserted across every
   * kind and both sides of each boundary, because this is the failure that
   * would be invisible until a user saw a full bar on a locked badge.
   */
  const cases: readonly (readonly [AchievementCriteria, ProgressSnapshot])[] = [
    [{ kind: 'spots', count: 100 }, snapshot({ spots: 99 })],
    [{ kind: 'spots', count: 100 }, snapshot({ spots: 100 })],
    [{ kind: 'streak', days: 7 }, snapshot({ streak: 6 })],
    [{ kind: 'streak', days: 7 }, snapshot({ streak: 7 })],
    [{ kind: 'lessons', count: 3 }, snapshot({ lessonsCompleted: 2 })],
    [{ kind: 'lessons', count: 3 }, snapshot({ lessonsCompleted: 3 })],
    [{ kind: 'mastery', accuracy: 0.9, minAttempts: 50 }, snapshot({ stats: [stat(49, 0.95)] })],
    [{ kind: 'mastery', accuracy: 0.9, minAttempts: 50 }, snapshot({ stats: [stat(50, 0.95)] })],
    [{ kind: 'mastery', accuracy: 0.9, minAttempts: 50 }, snapshot({ stats: [stat(500, 0.89)] })],
  ];

  it.each(cases)('agrees for %j against %j', (criteria, state) => {
    const { current, target } = achievementProgress(criteria, state);
    const complete = current >= target;
    const earned =
      evaluateAchievements([{ id: 'x', title: 'x', description: 'x', criteria }], state).length ===
      1;

    expect(complete).toBe(earned);
  });
});
