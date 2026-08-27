import { describe, expect, it } from 'vitest';

import type { PlacementAttempt } from '../src/curriculum';
import { PLACEMENT_MIN_ATTEMPTS, PLACEMENT_THRESHOLD, placeFrom } from '../src/curriculum';

/**
 * Placement decides how much of the course a person never sees, so the bias is
 * deliberately one-directional: placing someone too far *back* costs them
 * fifteen minutes re-reading something they knew, and placing them too far
 * *forward* costs them the one lesson that would have fixed the leak they came
 * here with. Only a clear pass counts as demonstrated.
 */

const ORDER = [
  'preflop.rfi.utg',
  'preflop.rfi.btn',
  'preflop.blind_defense.bb_vs_btn',
];

/** One group per tag, which is the degenerate case the maths is the same for. */
const GROUPS = ORDER.map((skillTag) => ({ skillTag, members: [skillTag] }));

function attempts(skillTag: string, tiers: readonly PlacementAttempt['tier'][]) {
  return tiers.map((tier) => ({ skillTag, tier }));
}

/** Four clean answers on a tag: unambiguously demonstrated. */
function passed(skillTag: string): readonly PlacementAttempt[] {
  return attempts(skillTag, ['optimal', 'optimal', 'optimal', 'acceptable']);
}

/** Four answers with two blunders: unambiguously not. */
function failed(skillTag: string): readonly PlacementAttempt[] {
  return attempts(skillTag, ['optimal', 'blunder', 'blunder', 'inaccurate']);
}

describe('placeFrom', () => {
  it('places at the first tag the user did not demonstrate', () => {
    const result = placeFrom({
      attempts: [...passed(ORDER[0]!), ...failed(ORDER[1]!), ...passed(ORDER[2]!)],
      groups: GROUPS,
    });

    expect(result.skillTag).toBe('preflop.rfi.btn');
  });

  it('places at the start when nothing was demonstrated', () => {
    const result = placeFrom({
      attempts: ORDER.flatMap((tag) => failed(tag)),
      groups: GROUPS,
    });

    expect(result.skillTag).toBe('preflop.rfi.utg');
  });

  it('places past everything when every tag was demonstrated', () => {
    const result = placeFrom({
      attempts: ORDER.flatMap((tag) => passed(tag)),
      groups: GROUPS,
    });

    // Null means "nothing left to place into" — the caller opens the track.
    expect(result.skillTag).toBeNull();
  });

  /**
   * `acceptable` is a defensible answer on a mixed hand, not a near-miss.
   * Counting only `optimal` would fail a user for playing a 50/50 spot the
   * other correct way, which is the exact error the four tiers exist to avoid.
   */
  it('counts acceptable as a pass, not a partial credit', () => {
    const result = placeFrom({
      attempts: attempts(ORDER[0]!, ['acceptable', 'acceptable', 'acceptable', 'acceptable']),
      groups: [GROUPS[0]!],
    });

    expect(result.skillTag).toBeNull();
  });

  it('treats a tag with no attempts as not demonstrated', () => {
    const result = placeFrom({
      attempts: passed(ORDER[0]!),
      groups: GROUPS,
    });

    expect(result.skillTag).toBe('preflop.rfi.btn');
  });

  it('refuses to place off a sample too small to mean anything', () => {
    const result = placeFrom({
      attempts: attempts(ORDER[0]!, ['optimal']),
      groups: GROUPS,
    });

    // One right answer is luck, not evidence.
    expect(result.skillTag).toBe('preflop.rfi.utg');
    expect(PLACEMENT_MIN_ATTEMPTS).toBeGreaterThan(1);
  });

  it('reports per-tag evidence, so the decision can be explained', () => {
    const result = placeFrom({
      attempts: [...passed(ORDER[0]!), ...failed(ORDER[1]!)],
      groups: GROUPS,
    });

    const utg = result.byTag.find((entry) => entry.skillTag === ORDER[0]);
    const btn = result.byTag.find((entry) => entry.skillTag === ORDER[1]);

    expect(utg?.demonstrated).toBe(true);
    expect(utg?.attempts).toBe(4);
    expect(btn?.demonstrated).toBe(false);
    expect(result.byTag).toHaveLength(ORDER.length);
  });

  it('ignores attempts on tags outside the ordering', () => {
    const result = placeFrom({
      attempts: [...passed(ORDER[0]!), ...passed('concept.nonsense')],
      groups: [GROUPS[0]!],
    });

    expect(result.skillTag).toBeNull();
    expect(result.byTag).toHaveLength(1);
  });

  it('needs a clear pass, not a bare majority', () => {
    // 50% right. Enough attempts, nowhere near the threshold.
    const result = placeFrom({
      attempts: attempts(ORDER[0]!, ['optimal', 'optimal', 'blunder', 'blunder']),
      groups: GROUPS,
    });

    expect(result.skillTag).toBe('preflop.rfi.utg');
    expect(PLACEMENT_THRESHOLD).toBeGreaterThan(0.5);
  });

  it('places at the start when the diagnostic was not taken at all', () => {
    expect(placeFrom({ attempts: [], groups: GROUPS }).skillTag).toBe(ORDER[0]);
  });

  it('refuses an empty ordering rather than guessing', () => {
    expect(() => placeFrom({ attempts: [], groups: [] })).toThrow(/ordering/i);
  });
});
