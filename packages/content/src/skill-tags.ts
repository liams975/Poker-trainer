/**
 * The skill-tag vocabulary.
 *
 * docs/04-data-model.md: "Define the vocabulary in `packages/content` and
 * constrain the column against it. Free-text tags will fragment within a week
 * and silently break weak-spot detection."
 *
 * These are the connective tissue between a lesson that teaches a spot, a
 * drill that exercises it, and a weakness detected in it — all three must
 * reference the same key, so the list is closed rather than a convention.
 *
 * Only the preflop tags the seeded charts actually use are declared. Lesson
 * and concept tags arrive with their content in Phase 8; adding to this list
 * is the deliberate, reviewable act it should be.
 */

export const SKILL_TAGS = [
  'preflop.rfi.utg',
  'preflop.rfi.hj',
  'preflop.rfi.co',
  'preflop.rfi.btn',
  'preflop.rfi.sb',
  'preflop.blind_defense.bb_vs_utg',
  'preflop.blind_defense.bb_vs_hj',
  'preflop.blind_defense.bb_vs_co',
  'preflop.blind_defense.bb_vs_btn',
  'preflop.blind_defense.bb_vs_sb',
] as const;

export type SkillTag = (typeof SKILL_TAGS)[number];

export function isSkillTag(value: unknown): value is SkillTag {
  return typeof value === 'string' && (SKILL_TAGS as readonly string[]).includes(value);
}
