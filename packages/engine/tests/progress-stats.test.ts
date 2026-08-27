import { describe, expect, it } from 'vitest';

import type { GradeTier } from '../src/drills';
import type { SkillStat, StatAttempt } from '../src/progress';
import {
  EWMA_ALPHA,
  WEAK_SPOT_CEILING,
  WEAK_SPOT_MIN_ATTEMPTS,
  rollUpSkillStats,
  weakSpots,
} from '../src/progress';

/**
 * The skill rollup, and what makes a spot "weak".
 *
 * `skill_stats` is a cache of `drill_attempts` — docs/04 has weak-spot
 * detection read the rollup rather than aggregate the log on every dashboard
 * load. That makes this function the single definition of what the numbers
 * mean, and the roadmap's exit criterion is that weak spots reflect *recent*
 * performance, which is the whole reason for an EWMA rather than an average.
 */

function run(skillTag: string, tiers: readonly GradeTier[], evLoss = 0): StatAttempt[] {
  return tiers.map((tier) => ({ skillTag, tier, evLoss }));
}

function repeat(tier: GradeTier, count: number): GradeTier[] {
  return Array.from({ length: count }, () => tier);
}

function statFor(stats: readonly SkillStat[], skillTag: string): SkillStat {
  const found = stats.find((stat) => stat.skillTag === skillTag);
  if (found === undefined) throw new Error(`no rollup for ${skillTag}`);
  return found;
}

describe('rollUpSkillStats', () => {
  it('counts attempts per tag', () => {
    const stats = rollUpSkillStats([
      ...run('preflop.rfi.btn', ['optimal', 'blunder']),
      ...run('preflop.rfi.utg', ['optimal']),
    ]);

    expect(statFor(stats, 'preflop.rfi.btn').attempts).toBe(2);
    expect(statFor(stats, 'preflop.rfi.utg').attempts).toBe(1);
  });

  /**
   * `acceptable` is a defensible answer to a mixed spot, not partial credit.
   * Counting it as a miss would reintroduce exactly the binary framing the four
   * tiers exist to reject, and would mark a 60/40 hand answered the 40 way as a
   * weakness.
   */
  it('counts acceptable as correct, alongside optimal', () => {
    const stats = rollUpSkillStats(run('preflop.rfi.btn', ['optimal', 'acceptable']));
    expect(statFor(stats, 'preflop.rfi.btn').correct).toBe(2);
  });

  it('counts inaccurate and blunder as incorrect', () => {
    const stats = rollUpSkillStats(run('preflop.rfi.btn', ['inaccurate', 'blunder']));
    expect(statFor(stats, 'preflop.rfi.btn').correct).toBe(0);
  });

  it('averages EV loss', () => {
    const stats = rollUpSkillStats([
      { skillTag: 'preflop.rfi.btn', tier: 'blunder', evLoss: 2 },
      { skillTag: 'preflop.rfi.btn', tier: 'optimal', evLoss: 0 },
    ]);

    expect(statFor(stats, 'preflop.rfi.btn').avgEvLoss).toBe(1);
  });

  /**
   * The bug that would look like a working feature.
   *
   * Seeding the EWMA at zero means a tag's first few answers are averaged
   * against an imaginary run of failures, so every *newly practised* tag reads
   * as a weakness. Weak-spot detection would then point at whatever the user
   * drilled most recently rather than most badly — and it would look plausible
   * every single time.
   */
  it('seeds the EWMA from the first answer, not from zero', () => {
    const stats = rollUpSkillStats(run('preflop.rfi.btn', ['optimal']));
    expect(statFor(stats, 'preflop.rfi.btn').ewmaAccuracy).toBe(1);
  });

  it('seeds at zero when the first answer was a blunder', () => {
    const stats = rollUpSkillStats(run('preflop.rfi.btn', ['blunder']));
    expect(statFor(stats, 'preflop.rfi.btn').ewmaAccuracy).toBe(0);
  });

  it('reads as a perfect score after a flawless run, not as an approach to one', () => {
    const stats = rollUpSkillStats(run('preflop.rfi.btn', repeat('optimal', 30)));
    expect(statFor(stats, 'preflop.rfi.btn').ewmaAccuracy).toBe(1);
  });

  it('applies the alpha to each subsequent answer', () => {
    // Perfect, then one miss: 1 -> (1 - alpha) * 1.
    const stats = rollUpSkillStats(run('preflop.rfi.btn', ['optimal', 'blunder']));
    expect(statFor(stats, 'preflop.rfi.btn').ewmaAccuracy).toBeCloseTo(1 - EWMA_ALPHA, 6);
  });

  /**
   * The exit criterion, stated as a property. Two tags with the *same* lifetime
   * accuracy, one improving and one collapsing: an average cannot tell them
   * apart and an EWMA must.
   */
  it('ranks a collapsing tag below an improving one at equal lifetime accuracy', () => {
    const improving = run('preflop.rfi.utg', [...repeat('blunder', 20), ...repeat('optimal', 20)]);
    const collapsing = run('preflop.rfi.btn', [...repeat('optimal', 20), ...repeat('blunder', 20)]);

    const stats = rollUpSkillStats([...improving, ...collapsing]);
    const up = statFor(stats, 'preflop.rfi.utg');
    const down = statFor(stats, 'preflop.rfi.btn');

    // Identical by every lifetime measure...
    expect(up.attempts).toBe(down.attempts);
    expect(up.correct).toBe(down.correct);
    // ...and unambiguously different by the one that matters.
    expect(up.ewmaAccuracy).toBeGreaterThan(down.ewmaAccuracy);
  });

  it('is order-sensitive, and says so by disagreeing with the reverse', () => {
    const tiers: GradeTier[] = [...repeat('blunder', 10), ...repeat('optimal', 10)];
    const forward = rollUpSkillStats(run('preflop.rfi.btn', tiers));
    const backward = rollUpSkillStats(run('preflop.rfi.btn', [...tiers].reverse()));

    expect(statFor(forward, 'preflop.rfi.btn').ewmaAccuracy).not.toBeCloseTo(
      statFor(backward, 'preflop.rfi.btn').ewmaAccuracy,
      3,
    );
  });

  it('keeps every value inside the ranges the columns allow', () => {
    const stats = rollUpSkillStats([
      ...run('preflop.rfi.btn', ['optimal', 'blunder', 'inaccurate'], 1.5),
      ...run('preflop.rfi.utg', ['acceptable'], 0),
    ]);

    for (const stat of stats) {
      // skill_stats_ewma_is_a_rate, skill_stats_counts_sane, ev_loss_nonneg.
      expect(stat.ewmaAccuracy).toBeGreaterThanOrEqual(0);
      expect(stat.ewmaAccuracy).toBeLessThanOrEqual(1);
      expect(stat.correct).toBeLessThanOrEqual(stat.attempts);
      expect(stat.avgEvLoss).toBeGreaterThanOrEqual(0);
    }
  });

  it('rounds to the precision the columns store', () => {
    const stats = rollUpSkillStats([
      ...run('preflop.rfi.btn', ['optimal', 'blunder', 'optimal'], 1 / 3),
    ]);
    const stat = statFor(stats, 'preflop.rfi.btn');

    // numeric(5,4) and numeric(8,4): a value the database would round on write
    // must not read back differently from what the engine computed.
    expect(stat.ewmaAccuracy).toBe(Math.round(stat.ewmaAccuracy * 10_000) / 10_000);
    expect(stat.avgEvLoss).toBe(Math.round(stat.avgEvLoss * 10_000) / 10_000);
  });

  it('returns nothing for no attempts', () => {
    expect(rollUpSkillStats([])).toEqual([]);
  });

  it('orders the result by tag, so two runs of the same data match', () => {
    const stats = rollUpSkillStats([
      ...run('preflop.rfi.utg', ['optimal']),
      ...run('preflop.blind_defense.bb_vs_btn', ['optimal']),
      ...run('preflop.rfi.btn', ['optimal']),
    ]);

    expect(stats.map((stat) => stat.skillTag)).toEqual([
      'preflop.blind_defense.bb_vs_btn',
      'preflop.rfi.btn',
      'preflop.rfi.utg',
    ]);
  });
});

describe('weakSpots', () => {
  function stat(skillTag: string, ewmaAccuracy: number, attempts: number): SkillStat {
    return { skillTag, attempts, correct: Math.round(ewmaAccuracy * attempts), ewmaAccuracy, avgEvLoss: 0 };
  }

  it('returns the lowest accuracies first', () => {
    const found = weakSpots([
      stat('preflop.rfi.utg', 0.7, 40),
      stat('preflop.rfi.btn', 0.3, 40),
      stat('preflop.rfi.co', 0.5, 40),
    ]);

    expect(found.map((s) => s.skillTag)).toEqual([
      'preflop.rfi.btn',
      'preflop.rfi.co',
      'preflop.rfi.utg',
    ]);
  });

  /**
   * The same conservatism placement uses, for the same reason. Telling somebody
   * their button opening is their weakest skill on the strength of two answers
   * sends them to drill noise, and they have no way to know it was noise.
   */
  it('ignores a tag with too few attempts to mean anything', () => {
    const found = weakSpots([
      stat('preflop.rfi.btn', 0, WEAK_SPOT_MIN_ATTEMPTS - 1),
      stat('preflop.rfi.utg', 0.6, WEAK_SPOT_MIN_ATTEMPTS),
    ]);

    expect(found.map((s) => s.skillTag)).toEqual(['preflop.rfi.utg']);
  });

  it('includes a tag exactly at the minimum', () => {
    const found = weakSpots([stat('preflop.rfi.btn', 0.2, WEAK_SPOT_MIN_ATTEMPTS)]);
    expect(found).toHaveLength(1);
  });

  it('is not a ranking of everything — a tag played well is not weak', () => {
    const found = weakSpots([
      stat('preflop.rfi.btn', 0.95, 40),
      stat('preflop.rfi.utg', WEAK_SPOT_CEILING, 40),
    ]);

    expect(found).toEqual([]);
  });

  it('caps the list', () => {
    const found = weakSpots(
      ['a', 'b', 'c', 'd', 'e'].map((tag, i) => stat(`preflop.rfi.${tag}`, i / 10, 40)),
    );

    expect(found.length).toBeLessThanOrEqual(3);
  });

  it('honours an explicit limit', () => {
    const found = weakSpots(
      ['a', 'b', 'c', 'd'].map((tag, i) => stat(`preflop.rfi.${tag}`, i / 10, 40)),
      { limit: 2 },
    );

    expect(found).toHaveLength(2);
  });

  it('breaks ties deterministically, so the rail does not reshuffle on reload', () => {
    const input = [
      stat('preflop.rfi.utg', 0.4, 40),
      stat('preflop.rfi.btn', 0.4, 40),
      stat('preflop.rfi.co', 0.4, 40),
    ];

    expect(weakSpots(input).map((s) => s.skillTag)).toEqual(
      weakSpots([...input].reverse()).map((s) => s.skillTag),
    );
  });

  it('returns nothing for a user with no history', () => {
    expect(weakSpots([])).toEqual([]);
  });
});
