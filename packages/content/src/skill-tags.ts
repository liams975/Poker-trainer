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
 * The preflop tags the seeded charts use, plus the `concept.*` tags Phase 8's
 * lesson content introduced. Adding to this list is the deliberate, reviewable
 * act it should be — a tag here is a promise that something teaches it and
 * something else can detect a weakness in it.
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

  // Concept tags, added with the Phase 8 lesson content. These name ideas
  // rather than spots, so no chart carries them and the placement diagnostic
  // cannot test them — a concept lesson is read, not drilled into.
  'concept.ranges_are_frequencies',
  'concept.mixed_strategies',
  'concept.position',
  'concept.pot_odds',
] as const;

export type SkillTag = (typeof SKILL_TAGS)[number];

export function isSkillTag(value: unknown): value is SkillTag {
  return typeof value === 'string' && (SKILL_TAGS as readonly string[]).includes(value);
}
