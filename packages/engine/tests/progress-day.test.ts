import { describe, expect, it } from 'vitest';

import { addDays, dayDiff, isDay } from '../src/progress';

/**
 * Calendar arithmetic, and the reason it lives in its own file.
 *
 * Streaks are day-granular in the *user's* timezone, and the classic way to get
 * that wrong is to subtract two timestamps and divide by 86,400,000 — which is
 * off by an hour twice a year in most of the world, and by thirty minutes in
 * Lord Howe. These functions never see a timestamp. They take calendar dates
 * that somebody else already resolved, and a calendar date has no timezone and
 * no DST to be wrong about.
 */

describe('isDay', () => {
  it('accepts an ISO calendar date', () => {
    expect(isDay('2026-08-26')).toBe(true);
    expect(isDay('2026-01-01')).toBe(true);
    expect(isDay('2026-12-31')).toBe(true);
  });

  it('rejects anything that is not exactly YYYY-MM-DD', () => {
    for (const value of [
      '2026-8-26',
      '26-08-26',
      '2026/08/26',
      '2026-08-26T00:00:00Z',
      ' 2026-08-26',
      '2026-08-26 ',
      '',
      null,
      undefined,
      20260826,
      new Date(),
    ]) {
      expect(isDay(value), `${String(value)} should not be a day`).toBe(false);
    }
  });

  /**
   * The one a regex alone gets wrong. `Date.UTC(2026, 1, 30)` happily returns
   * the 2nd of March, so a day that does not exist would silently become a day
   * that does — and the streak arithmetic would be quietly off by two.
   */
  it('rejects dates that pass the shape but are not on the calendar', () => {
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('2026-00-10')).toBe(false);
    expect(isDay('2026-04-31')).toBe(false);
    expect(isDay('2026-08-00')).toBe(false);
    expect(isDay('2026-08-32')).toBe(false);
  });

  it('knows which Februaries have a 29th', () => {
    expect(isDay('2024-02-29')).toBe(true);
    expect(isDay('2026-02-29')).toBe(false);
    // Divisible by 100 but not 400: not a leap year, which the naive rule misses.
    expect(isDay('2100-02-29')).toBe(false);
    expect(isDay('2000-02-29')).toBe(true);
  });
});

describe('dayDiff', () => {
  it('counts whole days forwards and backwards', () => {
    expect(dayDiff('2026-08-25', '2026-08-26')).toBe(1);
    expect(dayDiff('2026-08-26', '2026-08-26')).toBe(0);
    expect(dayDiff('2026-08-26', '2026-08-25')).toBe(-1);
    expect(dayDiff('2026-08-01', '2026-08-31')).toBe(30);
  });

  it('crosses month and year boundaries', () => {
    expect(dayDiff('2026-01-31', '2026-02-01')).toBe(1);
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1);
    expect(dayDiff('2024-02-28', '2024-03-01')).toBe(2);
    expect(dayDiff('2026-02-28', '2026-03-01')).toBe(1);
  });

  /**
   * The whole point. Every one of these spans a DST transition somewhere in the
   * world, and a millisecond-based implementation returns 0.958… or 1.041… and
   * then floors it to the wrong answer. Calendar dates are unaffected because
   * the arithmetic runs in UTC, which has no transitions.
   */
  it('is exactly one across every DST transition', () => {
    const transitions = [
      ['2026-03-07', '2026-03-08'], // US spring forward
      ['2026-11-01', '2026-11-02'], // US fall back
      ['2026-03-28', '2026-03-29'], // EU spring forward
      ['2026-10-24', '2026-10-25'], // EU fall back
      ['2026-04-04', '2026-04-05'], // Lord Howe, a 30-minute shift
      ['2026-09-26', '2026-09-27'], // Chatham, +12:45 to +13:45
    ] as const;

    for (const [from, to] of transitions) {
      expect(dayDiff(from, to), `${from} -> ${to}`).toBe(1);
    }
  });

  it('throws on a value that is not a calendar date', () => {
    expect(() => dayDiff('2026-02-30', '2026-03-01')).toThrow(/2026-02-30/);
    expect(() => dayDiff('2026-03-01', 'yesterday')).toThrow(/yesterday/);
  });
});

describe('addDays', () => {
  it('moves forwards and backwards', () => {
    expect(addDays('2026-08-26', 1)).toBe('2026-08-27');
    expect(addDays('2026-08-26', 0)).toBe('2026-08-26');
    expect(addDays('2026-08-26', -1)).toBe('2026-08-25');
    expect(addDays('2026-08-26', 7)).toBe('2026-09-02');
  });

  it('handles leap days and year ends', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('pads single-digit months and days', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-09', 1)).toBe('2026-01-10');
  });

  it('round-trips with dayDiff for any offset', () => {
    for (let offset = -400; offset <= 400; offset += 7) {
      const moved = addDays('2026-08-26', offset);
      expect(dayDiff('2026-08-26', moved), `offset ${offset}`).toBe(offset);
      expect(isDay(moved)).toBe(true);
    }
  });

  it('rejects a non-integer offset rather than truncating it', () => {
    expect(() => addDays('2026-08-26', 1.5)).toThrow(/whole days/);
  });
});
