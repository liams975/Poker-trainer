import { describe, expect, it } from 'vitest';

import type { GradeTier } from '../src/drills';
import type { HistoryAttempt } from '../src/progress';
import { accuracyOverTime, sessionDigest } from '../src/progress';

/**
 * Reading history back.
 *
 * `drill_attempts` has recorded every answer since Phase 7 and nothing has ever
 * read it. These are the two aggregations Session Review needs, and both are
 * here rather than in a query because a chart and a summary that disagree about
 * what a "day" is, or about whether `acceptable` counts, is the kind of thing
 * nobody notices and everybody half-believes.
 *
 * As with the rest of `progress`, there is **no clock**. A day is handed in
 * already resolved in the reader's own timezone — see `progress/day.ts` for why
 * that separation is the whole defence against the DST bug.
 */

function attempt(
  day: string,
  tier: GradeTier,
  evLoss = 0,
  skillTags: readonly string[] = ['preflop.rfi.btn'],
): HistoryAttempt {
  return { day, tier, evLoss, skillTags };
}

describe('accuracyOverTime', () => {
  it('buckets attempts by day', () => {
    const points = accuracyOverTime(
      [
        attempt('2026-08-24', 'optimal'),
        attempt('2026-08-24', 'blunder'),
        attempt('2026-08-25', 'optimal'),
      ],
      { from: '2026-08-24', to: '2026-08-25' },
    );

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ day: '2026-08-24', attempts: 2, passes: 1 });
    expect(points[1]).toMatchObject({ day: '2026-08-25', attempts: 1, passes: 1 });
  });

  it('runs oldest to newest', () => {
    const points = accuracyOverTime(
      [attempt('2026-08-26', 'optimal'), attempt('2026-08-24', 'optimal')],
      { from: '2026-08-24', to: '2026-08-26' },
    );

    expect(points.map((p) => p.day)).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
  });

  /**
   * A day with no practice is a fact about the history, not a missing record.
   * Dropping it would draw a chart in which three sessions a month apart look
   * like three consecutive days.
   */
  it('zero-fills days with no attempts', () => {
    const points = accuracyOverTime([attempt('2026-08-24', 'optimal')], {
      from: '2026-08-23',
      to: '2026-08-25',
    });

    expect(points.map((p) => p.day)).toEqual(['2026-08-23', '2026-08-24', '2026-08-25']);
    expect(points[0]?.attempts).toBe(0);
    expect(points[2]?.attempts).toBe(0);
  });

  /**
   * The same distinction the TODAY strip makes: "no data" and "0%" are
   * different claims, and only the first is true of a day nobody drilled.
   * A zero here would draw a line plunging to the floor on every rest day.
   */
  it('reports no accuracy at all for an empty day, not zero', () => {
    const points = accuracyOverTime([], { from: '2026-08-24', to: '2026-08-24' });

    expect(points[0]?.accuracy).toBeNull();
    expect(points[0]?.avgEvLoss).toBeNull();
  });

  it('counts acceptable as a pass, like every other measure in the app', () => {
    const points = accuracyOverTime(
      [attempt('2026-08-24', 'optimal'), attempt('2026-08-24', 'acceptable')],
      { from: '2026-08-24', to: '2026-08-24' },
    );

    expect(points[0]?.passes).toBe(2);
    expect(points[0]?.accuracy).toBe(1);
  });

  it('counts inaccurate and blunder as misses', () => {
    const points = accuracyOverTime(
      [attempt('2026-08-24', 'inaccurate'), attempt('2026-08-24', 'blunder')],
      { from: '2026-08-24', to: '2026-08-24' },
    );

    expect(points[0]?.passes).toBe(0);
    expect(points[0]?.accuracy).toBe(0);
  });

  it('averages EV loss within a day', () => {
    const points = accuracyOverTime(
      [attempt('2026-08-24', 'blunder', 2), attempt('2026-08-24', 'optimal', 0)],
      { from: '2026-08-24', to: '2026-08-24' },
    );

    expect(points[0]?.avgEvLoss).toBe(1);
  });

  it('ignores attempts outside the window rather than stretching it', () => {
    const points = accuracyOverTime(
      [
        attempt('2026-08-01', 'optimal'),
        attempt('2026-08-24', 'blunder'),
        attempt('2026-12-25', 'optimal'),
      ],
      { from: '2026-08-24', to: '2026-08-24' },
    );

    expect(points).toHaveLength(1);
    expect(points[0]?.attempts).toBe(1);
    expect(points[0]?.passes).toBe(0);
  });

  it('includes both endpoints of the window', () => {
    const points = accuracyOverTime(
      [attempt('2026-08-24', 'optimal'), attempt('2026-08-26', 'optimal')],
      { from: '2026-08-24', to: '2026-08-26' },
    );

    expect(points[0]?.attempts).toBe(1);
    expect(points[2]?.attempts).toBe(1);
  });

  it('handles a single-day window', () => {
    const points = accuracyOverTime([attempt('2026-08-24', 'optimal')], {
      from: '2026-08-24',
      to: '2026-08-24',
    });

    expect(points).toHaveLength(1);
  });

  it('crosses a month boundary without losing a day', () => {
    const points = accuracyOverTime([], { from: '2026-08-30', to: '2026-09-02' });

    expect(points.map((p) => p.day)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('rounds to the precision the columns store', () => {
    const points = accuracyOverTime(
      [
        attempt('2026-08-24', 'optimal', 1 / 3),
        attempt('2026-08-24', 'blunder', 1 / 3),
        attempt('2026-08-24', 'blunder', 1 / 3),
      ],
      { from: '2026-08-24', to: '2026-08-24' },
    );

    const point = points[0]!;
    expect(point.accuracy).toBe(Math.round(point.accuracy! * 10_000) / 10_000);
    expect(point.avgEvLoss).toBe(Math.round(point.avgEvLoss! * 10_000) / 10_000);
  });

  it('refuses a window that runs backwards rather than returning nothing', () => {
    expect(() =>
      accuracyOverTime([], { from: '2026-08-26', to: '2026-08-24' }),
    ).toThrow(/from.*to|backwards|before/i);
  });

  it('refuses a window that is not made of calendar dates', () => {
    expect(() => accuracyOverTime([], { from: '2026-02-30', to: '2026-03-01' })).toThrow(
      /2026-02-30/,
    );
  });

  /**
   * A year of daily points is 365 objects, which is fine; a decade by accident
   * because a date was parsed wrongly is not. The cap turns that into an error
   * at the boundary rather than a page that renders for six seconds.
   */
  it('refuses an absurdly long window', () => {
    expect(() => accuracyOverTime([], { from: '2000-01-01', to: '2026-01-01' })).toThrow(
      /window/i,
    );
  });
});

describe('sessionDigest', () => {
  it('reports the tier split, zero-filled', () => {
    const digest = sessionDigest([
      attempt('2026-08-24', 'optimal'),
      attempt('2026-08-24', 'blunder'),
    ]);

    expect(digest.spots).toBe(2);
    expect(digest.byTier).toEqual({ optimal: 1, acceptable: 0, inaccurate: 0, blunder: 1 });
  });

  it('agrees with the summary the drill runner already shows', () => {
    // Same numbers, from the same helper — a session that reads one way live
    // and another way in review would make both untrustworthy.
    const digest = sessionDigest([
      attempt('2026-08-24', 'blunder', 2),
      attempt('2026-08-24', 'optimal', 0),
    ]);

    expect(digest.totalEvLoss).toBe(2);
    expect(digest.avgEvLoss).toBe(1);
  });

  it('breaks the session down by skill tag', () => {
    const digest = sessionDigest([
      attempt('2026-08-24', 'optimal', 0, ['preflop.rfi.btn']),
      attempt('2026-08-24', 'blunder', 1, ['preflop.rfi.btn']),
      attempt('2026-08-24', 'optimal', 0, ['preflop.rfi.utg']),
    ]);

    const btn = digest.byTag.find((t) => t.skillTag === 'preflop.rfi.btn');
    expect(btn).toMatchObject({ attempts: 2, passes: 1, accuracy: 0.5 });

    const utg = digest.byTag.find((t) => t.skillTag === 'preflop.rfi.utg');
    expect(utg).toMatchObject({ attempts: 1, passes: 1, accuracy: 1 });
  });

  it('counts an attempt under each of its tags', () => {
    const digest = sessionDigest([
      attempt('2026-08-24', 'optimal', 0, ['preflop.rfi.btn', 'concept.position']),
    ]);

    expect(digest.byTag.map((t) => t.skillTag).sort()).toEqual([
      'concept.position',
      'preflop.rfi.btn',
    ]);
    // One spot, counted once per tag — the totals are not the sum of the tags.
    expect(digest.spots).toBe(1);
  });

  it('orders tags worst first, so the thing to work on is at the top', () => {
    const digest = sessionDigest([
      attempt('2026-08-24', 'optimal', 0, ['preflop.rfi.utg']),
      attempt('2026-08-24', 'optimal', 0, ['preflop.rfi.co']),
      attempt('2026-08-24', 'blunder', 2, ['preflop.rfi.btn']),
    ]);

    expect(digest.byTag[0]?.skillTag).toBe('preflop.rfi.btn');
  });

  it('breaks ties deterministically', () => {
    const attempts = [
      attempt('2026-08-24', 'optimal', 0, ['preflop.rfi.utg']),
      attempt('2026-08-24', 'optimal', 0, ['preflop.rfi.co']),
      attempt('2026-08-24', 'optimal', 0, ['preflop.rfi.btn']),
    ];

    expect(sessionDigest(attempts).byTag.map((t) => t.skillTag)).toEqual(
      sessionDigest([...attempts].reverse()).byTag.map((t) => t.skillTag),
    );
  });

  it('handles a session with no answers', () => {
    const digest = sessionDigest([]);

    expect(digest.spots).toBe(0);
    expect(digest.byTag).toEqual([]);
    expect(digest.avgEvLoss).toBe(0);
  });

  it('handles an attempt carrying no tags at all', () => {
    // Possible for a row written before the tag vocabulary covered its spot.
    const digest = sessionDigest([attempt('2026-08-24', 'optimal', 0, [])]);

    expect(digest.spots).toBe(1);
    expect(digest.byTag).toEqual([]);
  });
});
