import type { Day } from '@poker/engine';
import { isDay } from '@poker/engine';

/**
 * Which calendar day it is where the user is standing.
 *
 * This is the whole timezone boundary. `packages/engine/src/progress` holds no
 * clock and no zone — it takes a `YYYY-MM-DD` and does calendar arithmetic on
 * it — so the one place a zone is applied is here, and this file is the one
 * thing a DST test has to exercise.
 *
 * `Intl` is used rather than any offset arithmetic, and rather than being put
 * in the engine, for two separate reasons. Offset arithmetic is wrong twice a
 * year everywhere that observes DST and permanently wrong in the half-hour
 * zones. And the engine has to run unchanged in a React Native JS runtime in
 * v2 (docs/01-architecture.md), where Hermes has historically shipped without
 * full ICU — the purity rules do not ban `Intl`, but a package that must run
 * anywhere is not the place to depend on it.
 *
 * `en-CA` is not a locale preference. It is the locale whose short date format
 * is exactly `YYYY-MM-DD`, which is the format `streaks.last_active_date`
 * stores and `dayDiff` parses.
 */

const FORMAT_OPTIONS = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
} as const;

/** Cached: constructing a formatter is the expensive part, and zones repeat. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timeZone);
  if (existing !== undefined) return existing;

  const created = new Intl.DateTimeFormat('en-CA', { ...FORMAT_OPTIONS, timeZone });
  formatters.set(timeZone, created);
  return created;
}

/**
 * The calendar date at `instant`, in `timeZone`.
 *
 * An unknown zone falls back to UTC rather than throwing, for the same reason
 * `handle_new_user()` falls back rather than failing the signup: a bad timezone
 * must never cost somebody their streak or their page. `profiles.timezone` is
 * already constrained against `pg_timezone_names`, but that catalog is a
 * superset of what ICU knows, so the gap is real and small.
 */
export function localDay(timeZone: string, instant: Date = new Date()): Day {
  let formatted: string;

  try {
    formatted = formatterFor(timeZone).format(instant);
  } catch {
    formatted = formatterFor('UTC').format(instant);
  }

  // `en-CA` gives YYYY-MM-DD on every engine this runs on, but a formatter that
  // returned anything else would poison a date column rather than fail — so it
  // is checked, and UTC is the fallback for that too.
  if (!isDay(formatted)) {
    const utc = formatterFor('UTC').format(instant);
    return isDay(utc) ? utc : instant.toISOString().slice(0, 10);
  }

  return formatted;
}
