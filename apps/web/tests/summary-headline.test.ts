import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { headline } from '../src/components/drill/session-headline';
import type { SessionRewards } from '../src/lib/progress/types';

/**
 * Phase 16 gave the session summary a 44px serif line — frame 2f, "the one loud
 * moment in the app".
 *
 * A loud line is exactly where the rule `feedback-motion.test.ts` protects gets
 * broken next. That file stops a *flourish* being conditioned on a grade tier;
 * this one stops the *words* doing it. Two of the four tiers are correct
 * answers to a mixed spot, so a headline that read "sharp session" off the tier
 * split would assert a verdict the engine does not hold — and would say it
 * loudest, in the largest type on the screen.
 *
 * So the property is simple and absolute: **the headline is a function of
 * milestones only.** It never sees how the answers landed.
 */

function rewards(overrides: Partial<SessionRewards> = {}): SessionRewards {
  return {
    xpAwarded: 40,
    totalXp: 400,
    level: { level: 5, into: 0, need: 100, total: 400 },
    levelBefore: 5,
    streak: { current: 3, longest: 9, status: 'active', extendedToday: false },
    dailyGoal: { done: 4, target: 20, met: false },
    unlocked: [],
    weakSpots: [],
    ...overrides,
  } as SessionRewards;
}

describe('the headline names a milestone, or nothing', () => {
  it('names a level when one was crossed', () => {
    expect(headline(rewards({ levelBefore: 4 }))).toBe('Level 5.');
  });

  it('names an achievement when one was unlocked', () => {
    expect(
      headline(
        rewards({
          unlocked: [
            { id: 'first-hundred', title: 'First hundred', description: '', criteria: { kind: 'spots', count: 100 } },
          ],
        }),
      ),
    ).toBe('First hundred.');
  });

  it('names a streak record', () => {
    expect(
      headline(rewards({ streak: { current: 9, longest: 9, status: 'active', extendedToday: true } })),
    ).toBe('9-day streak, and a new best.');
  });

  it('falls back to a plain statement of fact', () => {
    expect(headline(rewards())).toBe('Session complete.');
  });

  it('says the same thing for an unscored session as for a flat one', () => {
    expect(headline(null)).toBe('Session complete.');
  });
});

describe('it cannot be conditioned on how the answers landed', () => {
  /**
   * Read as source, in the pattern `feedback-motion.test.ts` establishes: the
   * property is about *how the function is written*, and a render test can only
   * check the cases somebody thought to render.
   */
  const source = readFileSync(
    fileURLToPath(new URL('../src/components/drill/session-headline.ts', import.meta.url)),
    'utf8',
  );

  const body = (() => {
    const start = source.indexOf('export function headline');
    return source.slice(start, source.indexOf('\n}', start));
  })();

  it.each(['summary', 'byTier', 'evLoss', 'optimal', 'acceptable', 'inaccurate', 'blunder'])(
    'never reads %s',
    (forbidden) => {
      expect(body).not.toContain(forbidden);
    },
  );
});
