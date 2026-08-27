import { describe, expect, it } from 'vitest';

import { GRADE_TIERS } from '../src/drills';
import {
  DAILY_GOAL_SPOTS,
  XP_ACHIEVEMENT,
  XP_DAILY_GOAL,
  XP_LESSON_COMPLETE,
  XP_PER_TIER,
  isScoredMode,
  levelFor,
  totalXp,
  xpForAttempts,
} from '../src/progress';

/**
 * The XP schedule.
 *
 * `xp_events` is an append-only ledger and totals are always `sum(amount)` —
 * CLAUDE.md forbids storing a mutable counter, and the roadmap's exit criterion
 * is that totals reconcile with the ledger. That is only meaningful if the
 * schedule itself is one exported table rather than numbers sprinkled through a
 * route handler, which is what these tests pin.
 */

describe('XP_PER_TIER', () => {
  it('covers every grade tier', () => {
    for (const tier of GRADE_TIERS) {
      expect(XP_PER_TIER[tier], tier).toBeTypeOf('number');
    }
  });

  it('pays strictly more for a better answer', () => {
    expect(XP_PER_TIER.optimal).toBeGreaterThan(XP_PER_TIER.acceptable);
    expect(XP_PER_TIER.acceptable).toBeGreaterThan(XP_PER_TIER.inaccurate);
    expect(XP_PER_TIER.inaccurate).toBeGreaterThan(XP_PER_TIER.blunder);
  });

  /**
   * docs/05-ui-ux.md: "the tone is a coach nodding, not a slot machine". A
   * blunder still pays, because the spot was still practice — zero would frame
   * the session as a test to pass rather than a rep to do, and `acceptable` is
   * a defensible answer that must never look like a near-miss.
   */
  it('pays something for every answer, including a blunder', () => {
    for (const tier of GRADE_TIERS) {
      expect(XP_PER_TIER[tier], tier).toBeGreaterThan(0);
    }
  });
});

describe('xpForAttempts', () => {
  it('sums the schedule', () => {
    expect(xpForAttempts(['optimal', 'optimal', 'blunder'])).toBe(
      XP_PER_TIER.optimal * 2 + XP_PER_TIER.blunder,
    );
  });

  it('is zero for a session with no answers', () => {
    expect(xpForAttempts([])).toBe(0);
  });

  it('does not depend on the order the answers arrived in', () => {
    const tiers = ['blunder', 'optimal', 'acceptable', 'inaccurate'] as const;
    expect(xpForAttempts(tiers)).toBe(xpForAttempts([...tiers].reverse()));
  });
});

describe('isScoredMode', () => {
  /**
   * Study mode shows the chart *before* the answer, so its attempts measure
   * reading, not recall. Placement is a diagnostic taken before any teaching
   * has happened. Both are recorded — they are real history — and neither may
   * pay XP or move a skill rollup, or the numbers stop meaning what they say.
   */
  it('excludes study and placement', () => {
    expect(isScoredMode('study')).toBe(false);
    expect(isScoredMode('placement')).toBe(false);
  });

  it('includes every mode that tests recall', () => {
    expect(isScoredMode('quick')).toBe(true);
    expect(isScoredMode('focused')).toBe(true);
    expect(isScoredMode('weak_spots')).toBe(true);
    expect(isScoredMode('lesson')).toBe(true);
  });

  it('rejects a mode nobody defined rather than quietly scoring it', () => {
    expect(isScoredMode('freeplay')).toBe(false);
  });
});

describe('totalXp', () => {
  it('sums a ledger', () => {
    expect(totalXp([{ amount: 120 }, { amount: 50 }, { amount: XP_DAILY_GOAL }])).toBe(
      170 + XP_DAILY_GOAL,
    );
  });

  it('is zero for an empty ledger', () => {
    expect(totalXp([])).toBe(0);
  });

  /**
   * `xp_events.amount` is a plain `int` with a range check that permits
   * negatives, so a future correction entry is expressible. The total must
   * honour it rather than assuming the ledger only grows.
   */
  it('honours a negative correction entry', () => {
    expect(totalXp([{ amount: 100 }, { amount: -40 }])).toBe(60);
  });
});

describe('levelFor', () => {
  it('starts everyone at level 1 with nothing earned', () => {
    const level = levelFor(0);
    expect(level.level).toBe(1);
    expect(level.into).toBe(0);
    expect(level.needed).toBeGreaterThan(0);
  });

  it('never goes backwards as XP grows', () => {
    let previous = 0;
    for (let xp = 0; xp <= 20_000; xp += 37) {
      const { level } = levelFor(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  /**
   * The costs are read back out of `levelFor` rather than recomputed from its
   * own formula — asserting `50 * n * (n - 1)` here would only prove the test
   * and the implementation share a typo.
   */
  it('needs progressively more XP for each level', () => {
    // Every XP value at which the level ticks over, found by scanning.
    const boundaries: number[] = [0];
    for (let xp = 1; xp <= 60_000; xp++) {
      if (levelFor(xp).level > levelFor(xp - 1).level) boundaries.push(xp);
    }

    expect(boundaries.length).toBeGreaterThanOrEqual(9);

    const costs = boundaries.slice(1).map((xp, i) => xp - boundaries[i]!);
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]!, `level ${i + 3}`).toBeGreaterThan(costs[i - 1]!);
    }
  });

  it('reports progress through the current level, consistently with the boundary', () => {
    const at = levelFor(150);
    // `into` and `needed` must describe the same level the `level` field names:
    // stepping back `into` XP lands exactly on that level's first point.
    expect(levelFor(150 - at.into).level).toBe(at.level);
    expect(levelFor(150 - at.into - 1).level).toBe(at.level - 1);
    expect(levelFor(150 - at.into + at.needed).level).toBe(at.level + 1);
  });

  it('is exact on a level boundary rather than off by one', () => {
    for (let xp = 1; xp <= 30_000; xp++) {
      const here = levelFor(xp);
      if (here.level === levelFor(xp - 1).level) continue;
      // The first XP of a new level is `into === 0`, and one less is the last
      // XP of the previous one.
      expect(here.into, `boundary at ${xp}`).toBe(0);
      expect(levelFor(xp - 1).level).toBe(here.level - 1);
    }
  });

  it('treats a negative total as level 1 rather than throwing', () => {
    expect(levelFor(-10).level).toBe(1);
    expect(levelFor(-10).into).toBe(0);
  });

  it('holds `into` below `needed` at every point', () => {
    for (let xp = 0; xp <= 50_000; xp += 91) {
      const { into, needed } = levelFor(xp);
      expect(into).toBeGreaterThanOrEqual(0);
      expect(into).toBeLessThan(needed);
    }
  });
});

describe('the daily goal', () => {
  it('is a whole number of spots', () => {
    expect(Number.isInteger(DAILY_GOAL_SPOTS)).toBe(true);
    expect(DAILY_GOAL_SPOTS).toBeGreaterThan(0);
  });

  it('is worth more than the spots it takes to reach it are individually', () => {
    // Otherwise the bonus is noise next to the session it came from.
    expect(XP_DAILY_GOAL).toBeGreaterThan(XP_PER_TIER.optimal);
  });

  it('pays less for a day than a lesson pays for being read', () => {
    expect(XP_DAILY_GOAL).toBeLessThan(XP_LESSON_COMPLETE);
  });
});

describe('the one-off awards', () => {
  it('are all positive, so no award can silently subtract', () => {
    for (const [name, amount] of [
      ['lesson', XP_LESSON_COMPLETE],
      ['daily goal', XP_DAILY_GOAL],
      ['achievement', XP_ACHIEVEMENT],
    ] as const) {
      expect(amount, name).toBeGreaterThan(0);
      expect(Number.isInteger(amount), name).toBe(true);
    }
  });

  it('stay inside the bound the amount CHECK allows', () => {
    // xp_events_amount_bounded: between -100000 and 100000. A schedule that
    // could exceed it would fail at the boundary rather than at review.
    for (const amount of [XP_LESSON_COMPLETE, XP_DAILY_GOAL, XP_ACHIEVEMENT]) {
      expect(Math.abs(amount)).toBeLessThanOrEqual(100_000);
    }
    // And the biggest single session the runner can produce: 25 spots a batch.
    expect(xpForAttempts(Array.from({ length: 500 }, () => 'optimal'))).toBeLessThan(100_000);
  });
});
