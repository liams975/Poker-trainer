/**
 * Calendar days, as strings.
 *
 * `streaks.last_active_date` is a `date` and not a `timestamptz` because
 * docs/04-data-model.md makes streaks day-granular in the *user's* timezone.
 * The classic way to implement that wrongly is to subtract two instants and
 * divide by 86,400,000, which is off by an hour twice a year in most of the
 * world and by thirty minutes in Lord Howe — a bug that appears twice a year,
 * for one day, for a subset of users, and is therefore never reproduced.
 *
 * Nothing here takes an instant. A calendar date has already had the timezone
 * question answered; resolving *which* calendar day it is where the user is
 * standing happens once, at the web boundary, where `Intl` lives.
 *
 * `Date.UTC` is used below purely as a calendar calculator. UTC has no DST, so
 * the millisecond difference between two UTC midnights is always an exact
 * multiple of a day — which is the property the whole module rests on.
 */

/** An ISO calendar date, `YYYY-MM-DD`. Not a timestamp, and not zoned. */
export type Day = string;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

interface Parts {
  year: number;
  month: number;
  day: number;
}

function partsOf(value: string): Parts | null {
  const match = DAY_PATTERN.exec(value);
  if (match === null) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/**
 * Whether this is a date that exists.
 *
 * The shape check alone is not enough: `Date.UTC(2026, 1, 30)` cheerfully
 * returns the 2nd of March, so `2026-02-30` would become a real date two days
 * off from the one written down. Round-tripping the components catches that,
 * and gets leap years right for free rather than by reimplementing the rule.
 */
export function isDay(value: unknown): value is Day {
  if (typeof value !== 'string') return false;

  const parts = partsOf(value);
  if (parts === null) return false;

  const stamp = Date.UTC(parts.year, parts.month - 1, parts.day);
  const back = new Date(stamp);

  return (
    back.getUTCFullYear() === parts.year &&
    back.getUTCMonth() === parts.month - 1 &&
    back.getUTCDate() === parts.day
  );
}

function stampOf(value: Day, name: string): number {
  if (!isDay(value)) {
    throw new RangeError(`${name} must be a calendar date as YYYY-MM-DD, got ${String(value)}`);
  }

  const parts = partsOf(value)!;
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function dayDiff(from: Day, to: Day): number {
  return (stampOf(to, 'to') - stampOf(from, 'from')) / MS_PER_DAY;
}

/** The calendar date `count` days after `day`. `count` may be negative. */
export function addDays(day: Day, count: number): Day {
  if (!Number.isInteger(count)) {
    throw new RangeError(`addDays moves whole days, got ${count}`);
  }

  const moved = new Date(stampOf(day, 'day') + count * MS_PER_DAY);

  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1, 2)}-${pad(
    moved.getUTCDate(),
    2,
  )}`;
}
