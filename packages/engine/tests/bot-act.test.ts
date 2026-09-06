import { describe, expect, it } from 'vitest';

import type { LegalAction } from '../src/game';
import { sampleAction } from '../src/bot';
import type { ActionRecommendation } from '../src/strategy';
import { factor, rationale } from '../src/strategy';
import type { ActionFreq } from '../src/ranges';
import { mulberry32, rngFrom } from '../src/rng';

/**
 * Turning a distribution into one action.
 *
 * The property that matters is **legality**, and the order of operations is
 * what delivers it: filter to what the betting rules allow, *then* sample. The
 * other way round produces an action the rules reject roughly as often as the
 * chart happens to name one, which is not rare — the charts open to 2.5bb, and
 * a seat with 1.8bb behind cannot raise to 2.5.
 *
 * A bot that emits an illegal action does not misplay a hand; `applyAction`
 * throws and the whole session dies. So this is a correctness property, not a
 * strategic one.
 */

function recommendation(frequencies: readonly ActionFreq[]): ActionRecommendation {
  return {
    frequencies,
    primary: frequencies[0]!.action,
    // A rationale needs at least one factor; nothing here reads it.
    rationale: rationale([factor('mix', 'low', { actions: frequencies.length })]),
    source: 'chart',
    chartVersion: 'test',
  };
}

/** An rng that yields a fixed sequence of floats, for exact sampling checks. */
function scripted(floats: readonly number[]) {
  let index = 0;
  return rngFrom(() => Math.floor((floats[index++ % floats.length] ?? 0) * 0x1_0000_0000));
}

const CALL_OR_FOLD: readonly LegalAction[] = [{ action: 'fold' }, { action: 'call' }];

describe('sampleAction — sampling', () => {
  it('picks by cumulative frequency', () => {
    const rec = recommendation([
      { action: 'fold', freq: 0.3 },
      { action: 'call', freq: 0.7 },
    ]);

    // 0.1 lands in the first band, 0.9 in the second.
    expect(sampleAction(rec, CALL_OR_FOLD, scripted([0.1])).action).toBe('fold');
    expect(sampleAction(rec, CALL_OR_FOLD, scripted([0.9])).action).toBe('call');
  });

  it('closes each band below, so the boundary belongs to the next one', () => {
    /**
     * Split at 0.5 rather than at 0.3, because the boundary has to be
     * *representable* to be tested. `nextFloat` is `uint32 / 2^32`, and
     * 0.3 · 2^32 is not an integer — the closest this rng can produce is
     * 0.29999999981, which lands inside the first band and proves nothing
     * about the edge. 0.5 · 2^32 is exact.
     */
    const rec = recommendation([
      { action: 'fold', freq: 0.5 },
      { action: 'call', freq: 0.5 },
    ]);

    expect(sampleAction(rec, CALL_OR_FOLD, scripted([0.4999])).action).toBe('fold');
    expect(sampleAction(rec, CALL_OR_FOLD, scripted([0.5])).action).toBe('call');
  });

  it('is deterministic for a seed', () => {
    const rec = recommendation([
      { action: 'fold', freq: 0.5 },
      { action: 'call', freq: 0.5 },
    ]);

    const run = (seed: number) =>
      Array.from({ length: 20 }, () => {
        const rng = mulberry32(seed);
        return sampleAction(rec, CALL_OR_FOLD, rng).action;
      });

    expect(run(3)).toEqual(run(3));
  });

  it('honours the mix over many draws rather than always taking the primary', () => {
    const rec = recommendation([
      { action: 'fold', freq: 0.25 },
      { action: 'call', freq: 0.75 },
    ]);
    const rng = mulberry32(17);

    let folds = 0;
    for (let i = 0; i < 4000; i++) {
      if (sampleAction(rec, CALL_OR_FOLD, rng).action === 'fold') folds += 1;
    }

    // Ranges are mixed strategies; a bot that always played the top action
    // would be a different, and much more readable, opponent.
    expect(folds / 4000).toBeGreaterThan(0.2);
    expect(folds / 4000).toBeLessThan(0.3);
  });
});

describe('sampleAction — legality', () => {
  it('never returns an action the rules do not allow', () => {
    // The chart wants to raise. Hero is too short to raise at all.
    const rec = recommendation([
      { action: 'raise', size: 2.5, freq: 0.9 },
      { action: 'call', freq: 0.1 },
    ]);

    for (let i = 0; i < 200; i++) {
      const chosen = sampleAction(rec, CALL_OR_FOLD, mulberry32(i));
      expect(chosen.action, 'a raise was chosen with no raise available').not.toBe('raise');
    }
  });

  it('renormalises what is left rather than dropping the hand on the floor', () => {
    // Raise was 90% of the mix and is gone; call was 10% and is now all of it.
    const rec = recommendation([
      { action: 'raise', size: 2.5, freq: 0.9 },
      { action: 'call', freq: 0.1 },
    ]);

    expect(sampleAction(rec, CALL_OR_FOLD, scripted([0.99])).action).toBe('call');
  });

  it('clamps a size the stack cannot reach', () => {
    // The chart opens to 2.5bb; this seat can raise to at most 1.8.
    const rec = recommendation([{ action: 'raise', size: 2.5, freq: 1 }]);
    const legal: readonly LegalAction[] = [
      { action: 'fold' },
      { action: 'call' },
      { action: 'raise', minTo: 1.2, maxTo: 1.8 },
    ];

    const chosen = sampleAction(rec, legal, mulberry32(1));

    expect(chosen.action).toBe('raise');
    expect(chosen.size).toBe(1.8);
  });

  it('clamps a size below the minimum raise up to it', () => {
    const rec = recommendation([{ action: 'raise', size: 2.5, freq: 1 }]);
    const legal: readonly LegalAction[] = [
      { action: 'fold' },
      { action: 'call' },
      { action: 'raise', minTo: 9, maxTo: 100 },
    ];

    expect(sampleAction(rec, legal, mulberry32(1)).size).toBe(9);
  });

  it('falls back to the most passive legal action when nothing survives', () => {
    // A recommendation that names only actions this seat cannot take. Checking
    // is free here, so checking is the answer — never folding a free option.
    const rec = recommendation([{ action: 'raise', size: 2.5, freq: 1 }]);
    const legal: readonly LegalAction[] = [{ action: 'check' }];

    expect(sampleAction(rec, legal, mulberry32(1)).action).toBe('check');
  });

  it('folds as a last resort when there is nothing free', () => {
    const rec = recommendation([{ action: 'check', freq: 1 }]);

    expect(sampleAction(rec, CALL_OR_FOLD, mulberry32(1)).action).toBe('fold');
  });

  it('refuses when there is no legal action at all', () => {
    const rec = recommendation([{ action: 'check', freq: 1 }]);

    expect(() => sampleAction(rec, [], mulberry32(1))).toThrow(/legal/i);
  });
});
