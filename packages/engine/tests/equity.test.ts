import { describe, expect, it } from 'vitest';

import type { Combo } from '../src/cards';
import { parseCards } from '../src/cards';
import { exactEquity, equityVsHands, equityVsRange, monteCarloEquity, rangeCombos } from '../src/equity';
import { mulberry32 } from '../src/rng';

/**
 * docs/03-poker-engine.md, test plan: "Known benchmarks within tolerance.
 * Symmetry: equity(A,B) + equity(B,A) + ties = 1. Determinism under seed."
 *
 * The layering matters. `exactEquity` enumerates every runout, so it is ground
 * truth and is checked against published figures. `monteCarloEquity` is then
 * checked against *our* exact result rather than against a number copied from a
 * table — the same naive-vs-fast oracle pattern the evaluator uses.
 */

function combo(text: string): Combo {
  const [a, b] = parseCards(text);
  return [a!, b!];
}

const TRIALS = 60_000;

function mc(hero: Combo, villains: readonly Combo[], seed: number, board?: readonly string[]) {
  return monteCarloEquity(hero, villains, {
    rng: mulberry32(seed),
    trials: TRIALS,
    ...(board ? { board: parseCards(board.join('')) } : {}),
  });
}

describe('result shape', () => {
  it('reports fractions that sum to one', () => {
    const result = exactEquity(combo('AsKs'), [combo('QdQc')], parseCards('2h7c9d'));

    expect(result.win + result.tie + result.lose).toBeCloseTo(1, 12);
    expect(result.equity).toBeGreaterThan(0);
    expect(result.equity).toBeLessThan(1);
  });

  it('counts one runout for an already-complete board', () => {
    const result = exactEquity(combo('AsKs'), [combo('2c2d')], parseCards('QsJsTs3h4h'));

    expect(result.trials).toBe(1);
    expect(result.equity).toBe(1); // royal flush
    expect(result.win).toBe(1);
  });

  it('enumerates every river card on a turn board', () => {
    // 52 - 2 hero - 2 villain - 4 board = 44 possible rivers.
    const result = exactEquity(combo('AsKs'), [combo('2c2d')], parseCards('Qs Js Ts 3h'));

    expect(result.trials).toBe(44);
  });

  it('enumerates every turn-and-river pair on a flop board', () => {
    // C(45, 2) = 990
    const result = exactEquity(combo('AsKs'), [combo('2c2d')], parseCards('Qh Jd Tc'));

    expect(result.trials).toBe(990);
  });
});

describe('symmetry', () => {
  it('splits the pot exactly between two players', () => {
    const hero = combo('AsKs');
    const villain = combo('QdQc');
    const board = parseCards('2h7c9d');

    const a = exactEquity(hero, [villain], board);
    const b = exactEquity(villain, [hero], board);

    expect(a.equity + b.equity).toBeCloseTo(1, 12);
    // "equity(A,B) + equity(B,A) + ties = 1" in the win/tie/lose form.
    expect(a.win + b.win + a.tie).toBeCloseTo(1, 12);
    expect(a.tie).toBeCloseTo(b.tie, 12);
  });

  it('mirrors Monte Carlo results exactly when the arguments are swapped', () => {
    // Only holds because the board is dealt from the deck minus *all* hole
    // cards, so the runouts do not depend on who was named first.
    const hero = combo('AsKs');
    const villain = combo('QdQc');

    const a = mc(hero, [villain], 99);
    const b = mc(villain, [hero], 99);

    expect(a.win).toBe(b.lose);
    expect(a.lose).toBe(b.win);
    expect(a.tie).toBe(b.tie);
    expect(a.equity + b.equity).toBeCloseTo(1, 12);
  });

  it('divides a three-way pot into shares that sum to one', () => {
    const hands = [combo('AsKs'), combo('QdQc'), combo('7h7d')];
    const board = parseCards('2h9cJs');

    const total = hands.reduce((sum, hero, i) => {
      const villains = hands.filter((_h, j) => j !== i);
      return sum + exactEquity(hero, villains, board).equity;
    }, 0);

    expect(total).toBeCloseTo(1, 12);
  });
});

describe('determinism', () => {
  it('returns identical results for the same seed', () => {
    expect(mc(combo('AsKs'), [combo('QdQc')], 7)).toEqual(
      mc(combo('AsKs'), [combo('QdQc')], 7),
    );
  });

  it('returns different results for different seeds', () => {
    expect(mc(combo('AsKs'), [combo('QdQc')], 7).win).not.toBe(
      mc(combo('AsKs'), [combo('QdQc')], 8).win,
    );
  });
});

describe('known benchmarks', () => {
  // docs/02-roadmap.md names this one as the exit criterion.
  it('puts AKs against QQ at about 46%', () => {
    const exact = exactEquity(combo('AsKs'), [combo('QdQc')]);

    expect(exact.equity).toBeGreaterThan(0.45);
    expect(exact.equity).toBeLessThan(0.475);
  }, 60_000);

  it('puts AA against KK at about 82%', () => {
    const exact = exactEquity(combo('AsAh'), [combo('KdKc')]);

    expect(exact.equity).toBeGreaterThan(0.80);
    expect(exact.equity).toBeLessThan(0.84);
  }, 60_000);

  it('has Monte Carlo converge to the exact answer', () => {
    // The self-verifying half: no published number involved.
    const hero = combo('AsKs');
    const villain = combo('QdQc');
    const board = parseCards('2h7c9d');

    const exact = exactEquity(hero, [villain], board);
    const sampled = mc(hero, [villain], 12345, ['2h', '7c', '9d']);

    expect(Math.abs(sampled.equity - exact.equity)).toBeLessThan(0.01);
  });

  it('has Monte Carlo converge on a turn board too', () => {
    const hero = combo('9h8h');
    const villain = combo('AsAd');
    const board = parseCards('7h6c2s');

    const exact = exactEquity(hero, [villain], board);
    const sampled = mc(hero, [villain], 555, ['7h', '6c', '2s']);

    expect(Math.abs(sampled.equity - exact.equity)).toBeLessThan(0.01);
  });

  it('gives a dominated hand very little', () => {
    const exact = exactEquity(combo('Kd7c'), [combo('AsKs')]);

    expect(exact.equity).toBeLessThan(0.3);
  }, 60_000);
});

describe('rangeCombos', () => {
  it('expands notations to concrete combos', () => {
    expect(rangeCombos(['AA'], [])).toHaveLength(6);
    expect(rangeCombos(['AKs'], [])).toHaveLength(4);
    expect(rangeCombos(['AKo'], [])).toHaveLength(12);
    expect(rangeCombos(['AA', 'KK'], [])).toHaveLength(12);
  });

  it('removes combos blocked by dead cards', () => {
    // Holding two aces leaves exactly one AA combo for the opponent.
    expect(rangeCombos(['AA'], parseCards('AsAh'))).toHaveLength(1);
    // One dead ace removes the three AA combos containing it.
    expect(rangeCombos(['AA'], parseCards('As'))).toHaveLength(3);
    // A dead ace of spades kills only the suited combo that uses it.
    expect(rangeCombos(['AKs'], parseCards('As'))).toHaveLength(3);
  });

  it('can be blocked down to nothing', () => {
    expect(rangeCombos(['AKs'], parseCards('AsAhAdAc'))).toHaveLength(0);
  });

  it('deduplicates overlapping notations', () => {
    expect(rangeCombos(['AA', 'AA'], [])).toHaveLength(6);
  });

  it('rejects an unparseable notation', () => {
    expect(() => rangeCombos(['KAo'], [])).toThrow();
  });
});

describe('equityVsHands', () => {
  it('matches the hand-vs-hand answer when the range holds one combo', () => {
    const hero = combo('AsAh');
    // Hero blocks two aces, so this range is exactly AdAc.
    const viaRange = equityVsHands(hero, ['AA'], { rng: mulberry32(3), trials: TRIALS });
    const direct = mc(hero, [combo('AdAc')], 3);

    expect(Math.abs(viaRange.equity - direct.equity)).toBeLessThan(0.02);
  });

  it('puts aces well ahead of a kings-only range', () => {
    const result = equityVsHands(combo('AsAh'), ['KK'], { rng: mulberry32(4), trials: TRIALS });

    expect(result.equity).toBeGreaterThan(0.79);
    expect(result.equity).toBeLessThan(0.85);
  });

  it('weights a wider range toward the middle', () => {
    const tight = equityVsHands(combo('7c2d'), ['AA', 'KK', 'QQ'], {
      rng: mulberry32(5),
      trials: TRIALS,
    });
    const wide = equityVsHands(combo('7c2d'), ['72o', '83o', '94o'], {
      rng: mulberry32(5),
      trials: TRIALS,
    });

    expect(tight.equity).toBeLessThan(wide.equity);
  });

  it('converges to the exact average over the range', () => {
    // The range-level oracle. Enumerating every runout for every unblocked
    // villain combo and averaging gives the true number the sampler is aiming
    // at, so this needs no published figure at all. A flop board keeps it to
    // 990 runouts per combo.
    const hero = combo('AsAh');
    const board = parseCards('Kd7c2s');
    const combos = rangeCombos(['KK', 'QQ', 'JJ'], [...hero, ...board]);

    const exactAverage =
      combos.reduce((sum, v) => sum + exactEquity(hero, [v], board).equity, 0) / combos.length;

    const sampled = equityVsHands(hero, ['KK', 'QQ', 'JJ'], {
      rng: mulberry32(2468),
      trials: 200_000,
      board,
    });

    expect(Math.abs(sampled.equity - exactAverage)).toBeLessThan(0.005);
  }, 60_000);

  it('is deterministic under seed', () => {
    const once = equityVsHands(combo('AsAh'), ['KK', 'QQ'], { rng: mulberry32(6), trials: 5_000 });
    const twice = equityVsHands(combo('AsAh'), ['KK', 'QQ'], { rng: mulberry32(6), trials: 5_000 });

    expect(once).toEqual(twice);
  });

  it('rejects a range that hero blocks completely', () => {
    expect(() =>
      equityVsHands(combo('AsAh'), ['AA'], { rng: mulberry32(7), trials: 10, board: parseCards('AdAc2s') }),
    ).toThrow();
  });
});

/**
 * The weighted form, added in 12c.
 *
 * A chart is a mix: `AJo` opens from the cutoff 60% of the time. Sampling its
 * combos as often as `AA`'s overstates how much junk the raiser holds, which is
 * the same error `equityVsHands` makes in the other direction when it is handed
 * a range that was never uniform to begin with.
 *
 * Note what these do *not* import. `equityVsRange` takes a plain
 * notation-to-number record rather than Phase 2's `Range`, keeping the seam this
 * module's comment describes: "the weighted range type and the charts arrive in
 * Phase 2 and will convert down to this". `HandWeights` is structurally that
 * record, so a caller passes one straight in and equity stays Phase 1.
 */
describe('equityVsRange', () => {
  it('is exactly equityVsHands when one combo survives blocking', () => {
    // Hero holds two aces, so `AA` is exactly AdAc: a single candidate, picked
    // by one draw either way. Equality here is exact rather than approximate,
    // which is the strongest statement available that the two share a sampler.
    const hero = combo('AsAh');

    const weighted = equityVsRange(hero, { AA: 1 }, { rng: mulberry32(11), trials: 5_000 });
    const flat = equityVsHands(hero, ['AA'], { rng: mulberry32(11), trials: 5_000 });

    expect(weighted).toEqual(flat);
  });

  it('drops a hand weighted zero rather than sampling it', () => {
    const hero = combo('AsAh');

    const withZero = equityVsRange(hero, { AA: 1, KK: 0 }, { rng: mulberry32(12), trials: 5_000 });
    const without = equityVsRange(hero, { AA: 1 }, { rng: mulberry32(12), trials: 5_000 });

    expect(withZero).toEqual(without);
  });

  it('matches the flat form when every weight is equal', () => {
    const hero = combo('AsKd');
    const hands = ['QQ', 'JJ', 'TT'] as const;

    const weighted = equityVsRange(
      hero,
      { QQ: 0.5, JJ: 0.5, TT: 0.5 },
      { rng: mulberry32(13), trials: TRIALS },
    );
    const flat = equityVsHands(hero, [...hands], { rng: mulberry32(14), trials: TRIALS });

    expect(Math.abs(weighted.equity - flat.equity)).toBeLessThan(0.01);
  });

  it('moves toward the hands that carry the weight', () => {
    const hero = combo('7c2d');

    // The same two hands, weighted opposite ways. Against mostly-aces hero is
    // in bad shape; against mostly-junk he is much closer.
    const mostlyAces = equityVsRange(
      hero,
      { AA: 9, '83o': 1 },
      { rng: mulberry32(15), trials: TRIALS },
    );
    const mostlyJunk = equityVsRange(
      hero,
      { AA: 1, '83o': 9 },
      { rng: mulberry32(15), trials: TRIALS },
    );

    expect(mostlyAces.equity).toBeLessThan(mostlyJunk.equity);
  });

  it('converges to the weighted average over the range', () => {
    // The oracle again, this time weighted: enumerate every runout for every
    // unblocked combo and average with the weight its notation carries. No
    // published figure, and no trust in the sampler being tested.
    const hero = combo('AsAh');
    const board = parseCards('Kd7c2s');
    const weights = { KK: 0.25, QQ: 1, JJ: 0.5 } as const;

    let numerator = 0;
    let denominator = 0;
    for (const [hand, weight] of Object.entries(weights)) {
      for (const villain of rangeCombos([hand as 'KK'], [...hero, ...board])) {
        numerator += exactEquity(hero, [villain], board).equity * weight;
        denominator += weight;
      }
    }

    const sampled = equityVsRange(hero, weights, {
      rng: mulberry32(1357),
      trials: 200_000,
      board,
    });

    expect(Math.abs(sampled.equity - numerator / denominator)).toBeLessThan(0.005);
  }, 60_000);

  it('is deterministic under seed', () => {
    const once = equityVsRange(combo('AsAh'), { KK: 1, QQ: 0.4 }, { rng: mulberry32(16), trials: 5_000 });
    const twice = equityVsRange(combo('AsAh'), { KK: 1, QQ: 0.4 }, { rng: mulberry32(16), trials: 5_000 });

    expect(once).toEqual(twice);
  });

  it('rejects a weighting with nothing left in it', () => {
    expect(() => equityVsRange(combo('AsAh'), {}, { rng: mulberry32(17), trials: 10 })).toThrow();
    expect(() =>
      equityVsRange(combo('AsAh'), { KK: 0, QQ: 0 }, { rng: mulberry32(17), trials: 10 }),
    ).toThrow();
    expect(() =>
      equityVsRange(combo('AsAh'), { AA: 1 }, {
        rng: mulberry32(17),
        trials: 10,
        board: parseCards('AdAc2s'),
      }),
    ).toThrow();
  });

  it('rejects a negative weight rather than sampling it backwards', () => {
    expect(() =>
      equityVsRange(combo('AsAh'), { KK: 1, QQ: -1 }, { rng: mulberry32(18), trials: 10 }),
    ).toThrow();
  });
});

describe('input validation', () => {
  it('rejects a card appearing in two places', () => {
    expect(() => exactEquity(combo('AsKs'), [combo('AsQd')])).toThrow();
    expect(() => exactEquity(combo('AsKs'), [combo('QdQc')], parseCards('As2h3d'))).toThrow();
  });

  it('rejects an impossible board length', () => {
    expect(() => exactEquity(combo('AsKs'), [combo('QdQc')], parseCards('2h3d'))).toThrow();
    expect(() => exactEquity(combo('AsKs'), [combo('QdQc')], parseCards('2h3d4c5h6s7c'))).toThrow();
  });

  it('rejects a showdown with no opponent', () => {
    expect(() => exactEquity(combo('AsKs'), [])).toThrow();
  });

  it('rejects a non-positive trial count', () => {
    expect(() =>
      monteCarloEquity(combo('AsKs'), [combo('QdQc')], { rng: mulberry32(1), trials: 0 }),
    ).toThrow();
  });
});
