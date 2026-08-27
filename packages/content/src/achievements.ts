/**
 * The seeded achievements.
 *
 * Content, like the charts, the templates and the lessons: `achievements` is a
 * content table with a `criteria jsonb` column, so the set can be retuned by a
 * sync rather than a deploy.
 *
 * As everywhere else in this package, validation is deliberately not run at
 * import time — `rawAchievements` is exported unvalidated so the test suite can
 * report every problem at once instead of dying on import with a stack trace.
 */

import type { Achievement } from '@poker/engine';
import { validateAchievements } from '@poker/engine';

import achievements from './achievements.json';

/** Unvalidated. Use `loadAchievements()` unless you are the validator's test. */
export const rawAchievements: unknown = achievements;

let parsed: readonly Achievement[] | undefined;

/**
 * The validated achievements. Throws once, listing every problem, if invalid.
 *
 * The check that matters is that every `criteria` is one the engine's evaluator
 * understands. An achievement it does not is *invisible*: it syncs cleanly,
 * sits in the table, and never unlocks for anybody, with no error and nothing
 * on any page to notice.
 */
export function loadAchievements(): readonly Achievement[] {
  parsed ??= validateAchievements(rawAchievements);
  return parsed;
}
