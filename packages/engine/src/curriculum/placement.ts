/**
 * Turning a diagnostic drill into a starting point.
 *
 * The asymmetry here is deliberate and is the whole design. Placing someone too
 * far *back* costs them fifteen minutes re-reading material they already knew.
 * Placing them too far *forward* costs them the one lesson that would have
 * fixed the leak they arrived with — and they will never know it was skipped.
 * So a skill tag counts as demonstrated only on a clear pass over a sample big
 * enough to mean something, and anything short of that places at that tag.
 *
 * This runs on the server, never in the browser. docs/01-architecture.md §3
 * allows client-computed values in v1 on the condition that they "never gate
 * money or unlock content" — placement unlocks content, so the client may ask
 * for a placement but never state one.
 */

import type { DrillTemplate, GradeTier } from '../drills';

import type { Track } from './lesson';
import { orderedLessons } from './lesson';

/** One graded answer from the diagnostic, reduced to what placement needs. */
export interface PlacementAttempt {
  skillTag: string;
  tier: GradeTier;
}

/**
 * A tag is demonstrated at this pass rate or better. Well above a coin flip:
 * the point is to catch people who clearly already know a spot, not to sort
 * everyone precisely.
 */
export const PLACEMENT_THRESHOLD = 0.75;

/** Below this many answers on a tag, a good run is luck rather than evidence. */
export const PLACEMENT_MIN_ATTEMPTS = 3;

/**
 * One decision the diagnostic makes, at the granularity placement acts on.
 *
 * Grouped by *lesson*, not by tag, and the reason is sample size. Ten drillable
 * tags at three answers each is a thirty-spot diagnostic before anything can be
 * demonstrated — so a short one would leave every tag untested, place everybody
 * at lesson one, and look exactly like a working feature. Six lesson-sized
 * groups is a decision the same budget can actually support.
 */
export interface PlacementGroup {
  /** Returned as the placement when this group is not demonstrated. */
  skillTag: string;
  /** Every tag whose attempts count towards it. */
  members: readonly string[];
}

export interface GroupEvidence {
  skillTag: string;
  attempts: number;
  /** `optimal` or `acceptable` — both are defensible answers. */
  passes: number;
  demonstrated: boolean;
}

/** @deprecated name kept for the shape; groups replaced bare tags. */
export type TagEvidence = GroupEvidence;

export interface PlacementOptions {
  attempts: readonly PlacementAttempt[];
  /** The groups in course order. */
  groups: readonly PlacementGroup[];
}

export interface PlacementResult {
  /**
   * The first group not demonstrated, or `null` when every one was — which the
   * caller reads as "open the whole track".
   */
  skillTag: string | null;
  /** Per-group, in course order, so the decision can be explained rather than asserted. */
  byTag: readonly GroupEvidence[];
}

/**
 * `acceptable` counts as a pass.
 *
 * Counting only `optimal` would mark someone down for playing a genuine 50/50
 * spot the other correct way, which is precisely the single-right-action model
 * the four tiers exist to reject. docs/03-poker-engine.md is explicit that a
 * frequency ≥ 0.15 is a real part of the strategy.
 */
function isPass(tier: GradeTier): boolean {
  return tier === 'optimal' || tier === 'acceptable';
}

export function placeFrom(options: PlacementOptions): PlacementResult {
  const { attempts, groups } = options;

  if (groups.length === 0) {
    throw new RangeError('placement needs a non-empty ordering of groups to place within');
  }

  const byTag: GroupEvidence[] = groups.map((group) => {
    const members = new Set(group.members);
    const forGroup = attempts.filter((attempt) => members.has(attempt.skillTag));
    const passes = forGroup.filter((attempt) => isPass(attempt.tier)).length;

    return {
      skillTag: group.skillTag,
      attempts: forGroup.length,
      passes,
      // An untested group is not a demonstrated one. A short diagnostic will not
      // reach every group, and inferring competence from silence is exactly the
      // failure this whole function is shaped to avoid.
      demonstrated:
        forGroup.length >= PLACEMENT_MIN_ATTEMPTS &&
        passes / forGroup.length >= PLACEMENT_THRESHOLD,
    };
  });

  const firstGap = byTag.find((entry) => !entry.demonstrated);

  return { skillTag: firstGap?.skillTag ?? null, byTag };
}

/**
 * The skill tags a diagnostic can place within, in course order.
 *
 * Not simply every tag the track teaches. `concept.*` tags name ideas, and no
 * chart or drill template carries one, so a diagnostic can never demonstrate
 * them — including them would place every player at the first concept lesson no
 * matter how well they drilled, which is placement doing nothing at all and
 * saying nothing about it.
 *
 * Takes the tracks and templates as arguments so it works on what the database
 * actually published, not only on the bundled content.
 */
export function placementOrder(
  tracks: readonly Track[],
  templates: readonly DrillTemplate[],
): readonly PlacementGroup[] {
  const drillable = new Set(templates.flatMap((template) => template.skillTags));
  const groups: PlacementGroup[] = [];
  const claimed = new Set<string>();

  for (const track of tracks) {
    for (const lesson of orderedLessons(track)) {
      // A lesson's own drillable tags, minus any an earlier lesson already
      // owns — otherwise the second lesson to mention a tag would be graded on
      // answers the first one was already judged by.
      const members = lesson.skillTags.filter((tag) => drillable.has(tag) && !claimed.has(tag));
      if (members.length === 0) continue;

      for (const tag of members) claimed.add(tag);
      groups.push({ skillTag: members[0]!, members });
    }
  }

  return groups;
}
