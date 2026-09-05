import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The one regression in Phase 11 that would damage the product rather than
 * merely look wrong: **a celebration attached to an individual answer.**
 *
 * Phase 11's tone decision was milestones yes, answers never. That line is not
 * taste, it is the same rule the four grade tiers encode. Two of them —
 * `optimal` and `acceptable` — are defensible answers to a mixed spot, not a
 * pass and a near-miss. A flourish that fires on `optimal` and not on
 * `acceptable` tells the user there was a right answer, which for a hand that
 * opens 60% of the time is false; the same choice would be "correct" on Tuesday
 * and not on Wednesday.
 *
 * Read as source rather than rendered, in the pattern `review-queries.test.ts`
 * already establishes, because the property being checked is *how the file is
 * written*. A render test can only check the tiers somebody thought to render;
 * this checks that the coupling cannot be written at all.
 *
 * `e2e/drill-runner.spec.ts` greps the rendered panel for verdict words. This
 * is the same rule one layer down, at the place the next person to touch this
 * file would break it.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/components/drill/feedback-panel.tsx', import.meta.url)),
  'utf8',
);

/** The props that make something move. */
const MOTION_PROPS = ['initial', 'animate', 'exit', 'variants', 'transition', 'whileInView'];

/** Anything that names a tier, or the object the tier is reached through. */
const TIER_TOKENS = ['optimal', 'acceptable', 'inaccurate', 'blunder', 'grade.tier', 'tier.'];

describe('feedback-panel.tsx motion', () => {
  it('never conditions a motion prop on the grade tier', () => {
    // Each motion prop's value, taken as the balanced `{…}` or `"…"` after it.
    for (const prop of MOTION_PROPS) {
      const pattern = new RegExp(`\\b${prop}=\\{`, 'g');

      for (const match of SOURCE.matchAll(pattern)) {
        const start = (match.index ?? 0) + match[0].length;
        let depth = 1;
        let end = start;

        while (end < SOURCE.length && depth > 0) {
          if (SOURCE[end] === '{') depth += 1;
          if (SOURCE[end] === '}') depth -= 1;
          end += 1;
        }

        const value = SOURCE.slice(start, end - 1);

        for (const token of TIER_TOKENS) {
          expect(
            value.includes(token),
            `${prop}={…} reads "${token}" — motion must not depend on the grade:\n  ${value.trim()}`,
          ).toBe(false);
        }
      }
    }
  });

  it('does not pass the grade into the row that renders the mix', () => {
    // The other way the coupling could arrive: hand `grade` or `tier` down to
    // `MixRow` and branch inside it. `MixRow` takes the entry, whether it was
    // the user's, and its index — and nothing else.
    const signature = /function MixRow\(\{([^}]*)\}/.exec(SOURCE)?.[1] ?? '';

    expect(signature).not.toMatch(/\bgrade\b|\btier\b/);
  });

  it('still animates something, so the rule above is not vacuous', () => {
    // Without this, deleting every animation in the file would make the two
    // tests above pass perfectly. A guard on a property nothing has cannot fail.
    expect(SOURCE).toMatch(/<m\./);
    expect(SOURCE).toContain('animate=');
  });
});
