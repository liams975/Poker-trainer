import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Answer, Grade, GradeTier } from '@poker/engine';
import { GRADE_TIERS } from '@poker/engine';
import { describe, expect, it } from 'vitest';

import { ACTION_STYLES } from '../src/components/range/action-colors';
import { TIER_STYLES, sizeMessage, tierMessage } from '../src/components/drill/grade-tiers';

/**
 * The grade tier is where a poker trainer most easily starts lying to its user.
 *
 * Two of the four tiers are defensible answers, not partial credit. docs/05
 * therefore has tiers reuse the action palette rather than a red/green
 * pass-fail axis, and forbids ever telling someone they were wrong for choosing
 * a positive-frequency action. Both are enforced here, because both are the
 * kind of thing a later "small copy tweak" quietly undoes.
 */

function grade(overrides: Partial<Grade> & { tier: GradeTier }): Grade {
  return {
    frequency: 0.6,
    bestFrequency: 0.6,
    primary: 'raise',
    primarySize: 2.5,
    evLoss: 0,
    frequencies: [
      { action: 'raise', size: 2.5, freq: 0.6 },
      { action: 'fold', freq: 0.4 },
    ],
    ...overrides,
  };
}

const FOLD: Answer = { action: 'fold' };

describe('grade tier colours', () => {
  const actionHexes = new Set(Object.values(ACTION_STYLES).map((style) => style.hex));

  /**
   * The structural guard. There is no way to introduce a pass-fail red or green
   * here without first adding it to the action palette, where the colourblind
   * test would have to accept it.
   */
  it('draws every tier hue from the action palette', () => {
    for (const tier of GRADE_TIERS) {
      expect(actionHexes).toContain(TIER_STYLES[tier].hex);
    }
  });

  it('keeps the tier hues in the stylesheet, like the action tokens', () => {
    const css = readFileSync(resolve(__dirname, '../src/app/globals.css'), 'utf8').toLowerCase();

    for (const tier of GRADE_TIERS) {
      expect(css).toContain(TIER_STYLES[tier].hex.toLowerCase());
    }
  });

  it('never leaves a tier encoded by colour alone', () => {
    for (const tier of GRADE_TIERS) {
      expect(TIER_STYLES[tier].glyph.length).toBeGreaterThan(0);
      expect(TIER_STYLES[tier].label.length).toBeGreaterThan(0);
    }
  });

  it('gives each tier a distinguishable hue and label', () => {
    expect(new Set(GRADE_TIERS.map((t) => TIER_STYLES[t].hex)).size).toBe(GRADE_TIERS.length);
    expect(new Set(GRADE_TIERS.map((t) => TIER_STYLES[t].label)).size).toBe(GRADE_TIERS.length);
  });

  it('never labels a tier with a verdict word', () => {
    for (const tier of GRADE_TIERS) {
      expect(TIER_STYLES[tier].label.toLowerCase()).not.toMatch(
        /wrong|incorrect|fail|bad|mistake|error/,
      );
    }
  });
});

describe('tier copy', () => {
  /**
   * docs/05-ui-ux.md: "Never tell a user they were wrong when they chose a
   * positive-frequency action. That is both pedagogically false and the fastest
   * way to lose a knowledgeable player's trust."
   */
  it('never calls any answer wrong, at any tier', () => {
    for (const tier of GRADE_TIERS) {
      const message = tierMessage(grade({ tier }), FOLD).toLowerCase();
      expect(message).not.toMatch(/wrong|incorrect|mistake|\bbad\b|you failed|nope/);
    }
  });

  it('always states a frequency, because the mix is the lesson', () => {
    for (const tier of GRADE_TIERS) {
      expect(tierMessage(grade({ tier }), FOLD)).toMatch(/\d+%|<1%/);
    }
  });

  it('names the action the user actually chose', () => {
    const message = tierMessage(grade({ tier: 'acceptable' }), FOLD);
    expect(message).toContain('Fold');
  });

  it('calls a mixed spot mixed rather than second-best', () => {
    expect(tierMessage(grade({ tier: 'acceptable' }), FOLD)).toContain('mixed spot');
  });

  /**
   * The 50/50 case grade.ts warns about: the tier is optimal while `primary`
   * names the other action. The copy must not present `primary` as the answer.
   */
  it('does not present primary as the right answer on a tied hand', () => {
    const tied = grade({
      tier: 'optimal',
      frequency: 0.5,
      bestFrequency: 0.5,
      primary: 'raise',
      frequencies: [
        { action: 'raise', size: 2.5, freq: 0.5 },
        { action: 'fold', freq: 0.5 },
      ],
    });

    const message = tierMessage(tied, FOLD);
    expect(message.toLowerCase()).not.toMatch(/should have|correct answer|the right/);
    expect(message).toContain('Fold');
  });

  it('reports a blunder as absence from the mix, not as failure', () => {
    const message = tierMessage(grade({ tier: 'blunder', frequency: 0 }), FOLD);
    expect(message).toContain('not part of the mix');
  });

  it('covers every tier without falling through', () => {
    for (const tier of GRADE_TIERS) {
      expect(tierMessage(grade({ tier }), FOLD).length).toBeGreaterThan(10);
    }
  });
});

describe('size feedback', () => {
  it('says nothing when the size was right', () => {
    expect(sizeMessage(grade({ tier: 'optimal' }))).toBeNull();
  });

  it('names both sizes when it was not', () => {
    const message = sizeMessage(
      grade({ tier: 'optimal', sizeMismatch: { chose: 3, expected: 2.5 } }),
    );

    expect(message).toContain('3bb');
    expect(message).toContain('2.5bb');
  });
});
