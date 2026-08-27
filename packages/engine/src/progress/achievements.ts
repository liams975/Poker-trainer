/**
 * Achievements: content, with a criteria vocabulary the engine can evaluate.
 *
 * These are authored as JSON in `packages/content` and synced into the
 * `achievements` content table, exactly like charts, drill templates and
 * lessons. So they get the same treatment those got: validated against what the
 * code can actually *do* with them, not merely against a shape.
 *
 * The failure this exists to prevent is a quiet one. An achievement whose
 * criteria the evaluator does not understand is invisible — it syncs cleanly,
 * sits in the table, and never unlocks for anybody. There is no error, no empty
 * box on a page, nothing at all to notice. Phase 8 made the same argument about
 * a lesson block naming a chart nobody authored.
 *
 * Deliberately, no criteria kind names a skill tag. Postgres has no foreign key
 * into a jsonb field, so a tag in here would need the array-trigger treatment
 * `drill_attempts.skill_tags` gets — and "90% on any one skill" is the more
 * useful achievement anyway.
 */

import type { SkillStat } from './stats';

export const ACHIEVEMENT_KINDS = ['spots', 'streak', 'lessons', 'mastery'] as const;

export type AchievementKind = (typeof ACHIEVEMENT_KINDS)[number];

export type AchievementCriteria =
  | { kind: 'spots'; count: number }
  | { kind: 'streak'; days: number }
  | { kind: 'lessons'; count: number }
  | { kind: 'mastery'; accuracy: number; minAttempts: number };

export interface Achievement {
  id: string;
  title: string;
  description: string;
  criteria: AchievementCriteria;
}

export interface AchievementError {
  path: string;
  message: string;
}

export type AchievementValidation =
  | { ok: true; value: readonly Achievement[] }
  | { ok: false; errors: readonly AchievementError[] };

/** Everything an achievement can be judged against, at one moment. */
export interface ProgressSnapshot {
  /** Lifetime graded spots, in scored modes only. */
  spots: number;
  /** The streak as of today, not the stale stored counter. */
  streak: number;
  lessonsCompleted: number;
  stats: readonly SkillStat[];
}

const ID = /^[a-z0-9-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInt(
  errors: AchievementError[],
  path: string,
  value: unknown,
  field: string,
): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    errors.push({
      path: `${path}.criteria.${field}`,
      // A threshold of zero unlocks for everyone the moment they sign up, which
      // is not an achievement; a negative one is a typo either way.
      message: `${field} must be a whole number of at least 1, got ${String(value)}`,
    });
  }
}

function checkCriteria(errors: AchievementError[], path: string, raw: unknown): void {
  if (!isRecord(raw)) {
    errors.push({ path: `${path}.criteria`, message: 'criteria must be an object' });
    return;
  }

  const kind = raw.kind;

  if (typeof kind !== 'string' || !(ACHIEVEMENT_KINDS as readonly string[]).includes(kind)) {
    errors.push({
      path: `${path}.criteria.kind`,
      message: `unknown criteria kind ${String(kind)} — nothing can ever unlock it. Known kinds: ${ACHIEVEMENT_KINDS.join(', ')}`,
    });
    return;
  }

  switch (kind as AchievementKind) {
    case 'spots':
    case 'lessons':
      positiveInt(errors, path, raw.count, 'count');
      return;

    case 'streak':
      positiveInt(errors, path, raw.days, 'days');
      return;

    case 'mastery': {
      const accuracy = raw.accuracy;
      if (typeof accuracy !== 'number' || !(accuracy > 0) || accuracy > 1) {
        errors.push({
          path: `${path}.criteria.accuracy`,
          message: `accuracy is a rate between 0 and 1, got ${String(accuracy)}`,
        });
      }
      // Without a sample floor, a clean run of four answers is "mastery" —
      // the same trap weak-spot detection avoids from the other side.
      positiveInt(errors, path, raw.minAttempts, 'minAttempts');
      return;
    }
  }
}

export function parseAchievements(raw: unknown): AchievementValidation {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: [{ path: '', message: 'achievements must be an array' }] };
  }

  const errors: AchievementError[] = [];
  const seen = new Set<string>();

  raw.forEach((entry, index) => {
    const path = isRecord(entry) && typeof entry.id === 'string' ? entry.id : `[${index}]`;

    if (!isRecord(entry)) {
      errors.push({ path, message: 'an achievement must be an object' });
      return;
    }

    if (typeof entry.id !== 'string' || !ID.test(entry.id)) {
      errors.push({ path, message: `id must be lowercase kebab-case, got ${String(entry.id)}` });
    } else if (seen.has(entry.id)) {
      errors.push({ path, message: `duplicate id ${entry.id}` });
    } else {
      seen.add(entry.id);
    }

    // Both are rendered to the user, so an empty one is a blank badge rather
    // than a missing field somebody notices.
    if (typeof entry.title !== 'string' || entry.title.trim().length === 0) {
      errors.push({ path: `${path}.title`, message: 'title must be a non-empty string' });
    }
    if (typeof entry.description !== 'string' || entry.description.trim().length === 0) {
      errors.push({ path: `${path}.description`, message: 'description must be a non-empty string' });
    }

    checkCriteria(errors, path, entry.criteria);
  });

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, value: raw as readonly Achievement[] };
}

/** The throwing form, for a caller that has no way to recover. */
export function validateAchievements(raw: unknown): readonly Achievement[] {
  const result = parseAchievements(raw);

  if (!result.ok) {
    throw new Error(
      `invalid achievements:\n${result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
    );
  }

  return result.value;
}

function met(criteria: AchievementCriteria, snapshot: ProgressSnapshot): boolean {
  switch (criteria.kind) {
    case 'spots':
      return snapshot.spots >= criteria.count;
    case 'streak':
      return snapshot.streak >= criteria.days;
    case 'lessons':
      return snapshot.lessonsCompleted >= criteria.count;
    case 'mastery':
      // Both bars, on the same tag. Either alone hands the badge to noise.
      return snapshot.stats.some(
        (stat) =>
          stat.attempts >= criteria.minAttempts && stat.ewmaAccuracy >= criteria.accuracy,
      );
  }
}

/**
 * Every achievement this snapshot has earned.
 *
 * Earned, not *newly* earned. Which of these are already recorded is the
 * database's business — `user_achievements` has a composite primary key exactly
 * so re-inserting one is a no-op, and deciding "new" in here would need
 * evaluation to know about storage.
 */
export function evaluateAchievements(
  achievements: readonly Achievement[],
  snapshot: ProgressSnapshot,
): readonly string[] {
  return achievements.filter((entry) => met(entry.criteria, snapshot)).map((entry) => entry.id);
}
