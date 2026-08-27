import { advanceStreak, dayDiff } from '@poker/engine';
import { describe, expect, it } from 'vitest';

import { localDay } from '../src/lib/progress/timezone';

/**
 * The timezone boundary, and the roadmap's first Phase 9 exit criterion: the
 * streak survives a timezone change and does not break across DST.
 *
 * The engine cannot fail that criterion — it works on calendar dates, where
 * DST does not exist. Everything that could go wrong goes wrong *here*, in the
 * one function that turns an instant into a day. So this file is where the real
 * zones, the real transitions and the real edge cases live.
 */

describe('localDay', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(localDay('UTC', new Date('2026-08-26T12:00:00Z'))).toBe('2026-08-26');
  });

  it('uses the zone, not the machine the code runs on', () => {
    // 03:00 UTC is still the 25th in New York and already the 26th in Tokyo.
    const instant = new Date('2026-08-26T03:00:00Z');

    expect(localDay('America/New_York', instant)).toBe('2026-08-25');
    expect(localDay('Asia/Tokyo', instant)).toBe('2026-08-26');
    expect(localDay('UTC', instant)).toBe('2026-08-26');
  });

  /**
   * One instant, two different calendar dates, fourteen hours apart. If a
   * streak is computed in UTC for everybody, these two users get each other's
   * day boundaries — which is not a DST bug and would survive every DST test.
   */
  it('spans the full range of world offsets', () => {
    const instant = new Date('2026-08-26T11:00:00Z');

    expect(localDay('Pacific/Kiritimati', instant)).toBe('2026-08-27'); // +14
    expect(localDay('Pacific/Midway', instant)).toBe('2026-08-26'); // -11
    expect(localDay('Pacific/Midway', new Date('2026-08-26T05:00:00Z'))).toBe('2026-08-25');
  });

  describe('across a DST transition', () => {
    /**
     * The failure mode being excluded: an implementation that adds a fixed
     * offset, or that subtracts two instants and divides by 86,400,000. On the
     * day the clocks move, that day is 23 or 25 hours long and both approaches
     * land on the wrong date for part of it.
     */
    it('gets the day right either side of US spring forward', () => {
      // 2026-03-08, 02:00 EST becomes 03:00 EDT.
      expect(localDay('America/New_York', new Date('2026-03-08T06:30:00Z'))).toBe('2026-03-08');
      expect(localDay('America/New_York', new Date('2026-03-08T07:30:00Z'))).toBe('2026-03-08');
      expect(localDay('America/New_York', new Date('2026-03-09T03:59:00Z'))).toBe('2026-03-08');
      expect(localDay('America/New_York', new Date('2026-03-09T04:01:00Z'))).toBe('2026-03-09');
    });

    it('gets the day right either side of US fall back', () => {
      // 2026-11-01, 02:00 EDT becomes 01:00 EST — 01:30 happens twice.
      expect(localDay('America/New_York', new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01');
      expect(localDay('America/New_York', new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01');
      expect(localDay('America/New_York', new Date('2026-11-02T04:59:00Z'))).toBe('2026-11-01');
      expect(localDay('America/New_York', new Date('2026-11-02T05:01:00Z'))).toBe('2026-11-02');
    });

    it('gets the day right across EU transitions', () => {
      expect(localDay('Europe/London', new Date('2026-03-29T00:30:00Z'))).toBe('2026-03-29');
      expect(localDay('Europe/London', new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-25');
      expect(localDay('Europe/London', new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25');
    });

    /**
     * Lord Howe shifts by *thirty minutes*, not an hour. Any implementation
     * built on whole-hour offsets is permanently wrong here rather than wrong
     * twice a year, and it is the case a UTC-based test never reaches.
     */
    it('handles a half-hour DST shift', () => {
      // +10:30 in winter, +11:00 in summer.
      expect(localDay('Australia/Lord_Howe', new Date('2026-06-30T13:45:00Z'))).toBe('2026-07-01');
      expect(localDay('Australia/Lord_Howe', new Date('2026-06-30T13:15:00Z'))).toBe('2026-06-30');
    });

    it('handles a zone that abolished DST', () => {
      // São Paulo dropped DST in 2019; a hardcoded rule table still shifts it.
      expect(localDay('America/Sao_Paulo', new Date('2026-01-15T02:30:00Z'))).toBe('2026-01-14');
    });

    it('handles a 45-minute offset', () => {
      expect(localDay('Asia/Kathmandu', new Date('2026-08-25T18:20:00Z'))).toBe('2026-08-26');
      expect(localDay('Asia/Kathmandu', new Date('2026-08-25T18:10:00Z'))).toBe('2026-08-25');
    });
  });

  describe('when the zone is unusable', () => {
    it('falls back to UTC rather than throwing', () => {
      // A bad zone must never cost somebody their page. `profiles.timezone` is
      // checked against pg_timezone_names, which is a superset of what ICU knows.
      expect(localDay('Mars/Olympus_Mons', new Date('2026-08-26T12:00:00Z'))).toBe('2026-08-26');
      expect(localDay('', new Date('2026-08-26T12:00:00Z'))).toBe('2026-08-26');
    });
  });

  it('is stable across repeated calls, so the cached formatter is safe', () => {
    const instant = new Date('2026-08-26T03:00:00Z');

    for (let i = 0; i < 3; i++) {
      expect(localDay('America/New_York', instant)).toBe('2026-08-25');
      expect(localDay('Asia/Tokyo', instant)).toBe('2026-08-26');
    }
  });
});

/**
 * The criterion end to end: the boundary and the rule together.
 */
describe('a streak across a DST transition', () => {
  it('counts one day per calendar day through spring forward', () => {
    // 20:00 local each evening, over the weekend the clocks move.
    const evenings = [
      new Date('2026-03-06T01:00:00Z'), // Thu 20:00 EST
      new Date('2026-03-07T01:00:00Z'), // Fri 20:00 EST
      new Date('2026-03-08T01:00:00Z'), // Sat 20:00 EST
      new Date('2026-03-09T00:00:00Z'), // Sun 20:00 EDT — one hour "earlier" in UTC
      new Date('2026-03-10T00:00:00Z'), // Mon 20:00 EDT
    ];

    let state = { current: 0, longest: 0, lastActiveDate: null as string | null };

    for (const instant of evenings) {
      state = advanceStreak({ state, today: localDay('America/New_York', instant) });
    }

    expect(state.current).toBe(5);
  });

  it('counts one day per calendar day through fall back', () => {
    const evenings = [
      new Date('2026-10-30T00:00:00Z'), // Thu 20:00 EDT
      new Date('2026-10-31T00:00:00Z'), // Fri 20:00 EDT
      new Date('2026-11-01T00:00:00Z'), // Sat 20:00 EDT
      new Date('2026-11-02T01:00:00Z'), // Sun 20:00 EST
      new Date('2026-11-03T01:00:00Z'), // Mon 20:00 EST
    ];

    let state = { current: 0, longest: 0, lastActiveDate: null as string | null };

    for (const instant of evenings) {
      state = advanceStreak({ state, today: localDay('America/New_York', instant) });
    }

    expect(state.current).toBe(5);
  });

  /**
   * Two sessions 23 hours apart, either side of a spring-forward — different
   * calendar days locally. Millisecond arithmetic reads this as "not yet a
   * day" and refuses to advance the streak.
   */
  it('advances on a 23-hour day', () => {
    const before = localDay('America/New_York', new Date('2026-03-07T23:00:00Z')); // Sat 18:00
    const after = localDay('America/New_York', new Date('2026-03-08T22:00:00Z')); // Sun 18:00 EDT

    expect(dayDiff(before, after)).toBe(1);

    const next = advanceStreak({
      state: { current: 3, longest: 3, lastActiveDate: before },
      today: after,
    });

    expect(next.current).toBe(4);
  });

  /**
   * And the other direction: 25 hours apart is still exactly one day, not two.
   */
  it('does not skip a day on a 25-hour day', () => {
    const before = localDay('America/New_York', new Date('2026-10-31T22:00:00Z')); // Sat 18:00 EDT
    const after = localDay('America/New_York', new Date('2026-11-01T23:00:00Z')); // Sun 18:00 EST

    expect(dayDiff(before, after)).toBe(1);
    expect(
      advanceStreak({ state: { current: 3, longest: 3, lastActiveDate: before }, today: after })
        .reset,
    ).toBe(false);
  });
});

/**
 * The other half of the criterion: a user who *moves*.
 */
describe('a streak across a timezone change', () => {
  it('survives a westward flight that repeats a local date', () => {
    // Drills in Auckland on the 26th, flies to Los Angeles, drills on landing —
    // where it is still the 25th.
    const auckland = localDay('Pacific/Auckland', new Date('2026-08-26T08:00:00Z'));
    const losAngeles = localDay('America/Los_Angeles', new Date('2026-08-26T09:00:00Z'));

    expect(auckland).toBe('2026-08-26');
    expect(losAngeles).toBe('2026-08-26');

    // And the sharper version, a full day earlier locally.
    const earlier = localDay('America/Los_Angeles', new Date('2026-08-25T20:00:00Z'));
    expect(earlier).toBe('2026-08-25');

    const next = advanceStreak({
      state: { current: 6, longest: 6, lastActiveDate: auckland },
      today: earlier,
    });

    expect(next.current).toBe(6);
    expect(next.lastActiveDate).toBe('2026-08-26');
  });

  it('resumes the next local day after moving', () => {
    const moved = advanceStreak({
      state: { current: 6, longest: 6, lastActiveDate: '2026-08-26' },
      today: localDay('America/Los_Angeles', new Date('2026-08-25T20:00:00Z')),
    });

    const next = advanceStreak({
      state: moved,
      today: localDay('America/Los_Angeles', new Date('2026-08-27T20:00:00Z')),
    });

    expect(next.current).toBe(7);
  });
});
