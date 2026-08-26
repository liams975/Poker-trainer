import type { Answer, Grade, GradeTier } from '@poker/engine';

// Relative, not `@/` — the same reason mix-format.ts is: both vitest's web
// project and Playwright's loader import this module directly, and neither
// resolves the Next path alias. A pure module that both suites can read is
// worth more than the tidier import.
import { ACTION_STYLES, actionLabel } from '../range/action-colors';
import { percent } from '../range/mix-format';

/**
 * How a grade tier looks and what it says.
 *
 * **Tiers reuse the action palette rather than a red/green pass-fail axis.**
 * That is docs/05-ui-ux.md's decision, not a shortcut: "optimal reads as
 * confident, blunder as alarming, without implying that 'not optimal' means
 * failure — which for mixed strategies would be false." Two of these four tiers
 * are defensible answers. A green tick and a red cross would tell the user
 * something the engine does not believe.
 *
 * Reading the hues from `ACTION_STYLES` rather than restating them is what
 * keeps that true over time: there is no way to introduce a new pass-fail hue
 * here without adding it to the action palette first, where the colourblind
 * test would have to accept it.
 */
export interface TierStyle {
  /** Always an action hue. See above. */
  hex: string;
  /** Fill of the pie, matching how much of the mix the answer was. */
  glyph: string;
  label: string;
}

export const TIER_STYLES: Readonly<Record<GradeTier, TierStyle>> = {
  optimal: { hex: ACTION_STYLES.check.hex, glyph: '●', label: 'Optimal' },
  acceptable: { hex: ACTION_STYLES.call.hex, glyph: '◐', label: 'Also fine' },
  inaccurate: { hex: ACTION_STYLES.allin.hex, glyph: '◔', label: 'Thin' },
  blunder: { hex: ACTION_STYLES.raise.hex, glyph: '○', label: 'Not in the mix' },
};

export function tierStyle(tier: GradeTier): TierStyle {
  return TIER_STYLES[tier];
}

/**
 * The sentence under the badge.
 *
 * docs/05's copy rule is absolute: "Never tell a user they were wrong when they
 * chose a positive-frequency action. That is both pedagogically false and the
 * fastest way to lose a knowledgeable player's trust." So every message states
 * a frequency and none of them contains a verdict word.
 *
 * `grade.primary` is mentioned as *what the hand mostly does*, never as "the
 * right answer" — on a 50/50 hand the tier is optimal while `primary` names the
 * other action, and grade.ts is explicit that the tier is the judgement.
 */
export function tierMessage(grade: Grade, answer: Answer): string {
  const chose = actionLabel(answer.action, answer.size);
  const share = percent(grade.frequency);
  const mostly = actionLabel(grade.primary, grade.primarySize);

  switch (grade.tier) {
    case 'optimal':
      return `${chose} is the highest-frequency line here, at ${share}.`;
    case 'acceptable':
      return `Also fine — this is a mixed spot. ${chose} at ${share}, mostly ${mostly} at ${percent(grade.bestFrequency)}.`;
    case 'inaccurate':
      return `${chose} is only ${share} of the mix here. Mostly ${mostly} at ${percent(grade.bestFrequency)}.`;
    case 'blunder':
      return `${chose} is not part of the mix here. This hand is ${mostly} at ${percent(grade.bestFrequency)}.`;
  }
}

/** Shown only when the action was right and the size was not. */
export function sizeMessage(grade: Grade): string | null {
  if (grade.sizeMismatch === undefined) return null;

  const { chose, expected } = grade.sizeMismatch;
  return `Sizing: you chose ${chose}bb, the chart uses ${expected}bb.`;
}
