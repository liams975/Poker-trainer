import { describe, expect, it } from 'vitest';

import {
  RANK_MIN_SPOTS,
  RANK_TIERS,
  type RankedAttempt,
  evLossPerSpot,
  rankFor,
} from '../src/progress/rank';

/**
 * The ladder is specified by the v2 design deck, not invented here:
 *
 *   Limper (start) · Reg −0.55 · Grinder −0.42 · Crusher −0.30 · Nemesis −0.20
 *
 * with two properties the deck states in prose and this file turns into
 * assertions: it is computed over the **last 200 graded answers**, and it
 * **moves down as well as up**. A ladder that only ratchets upward is a
 * participation trophy, and the deck is explicit that this one is not.
 */

function attempts(evLosses: readonly number[]): readonly RankedAttempt[] {
  return evLosses.map((evLoss) => ({ evLoss }));
}

/** `count` answers that all lost exactly `evLoss`, so the mean is exactly that. */
function flat(count: number, evLoss: number): readonly RankedAttempt[] {
  return attempts(Array.from({ length: count }, () => evLoss));
}

describe('a rank needs enough evidence to mean anything', () => {
  it('withholds a rank below the minimum sample', () => {
    expect(rankFor(flat(RANK_MIN_SPOTS - 1, 0.1))).toBeUndefined();
  });

  it('awards one exactly at the minimum', () => {
    expect(rankFor(flat(RANK_MIN_SPOTS, 0.1))).toBeDefined();
  });

  it('is 200, so a hot streak of four hands cannot top a board', () => {
    expect(RANK_MIN_SPOTS).toBe(200);
  });
});

describe('the ladder matches the deck', () => {
  it('names the five tiers in order, hardest last', () => {
    expect(RANK_TIERS.map((tier) => tier.name)).toEqual([
      'Limper',
      'Reg',
      'Grinder',
      'Crusher',
      'Nemesis',
    ]);
  });

  it.each([
    [0.9, 'Limper'],
    [0.55, 'Reg'],
    [0.42, 'Grinder'],
    [0.3, 'Crusher'],
    [0.2, 'Nemesis'],
    [0.01, 'Nemesis'],
  ])('puts %sbb lost per spot in %s', (evLoss, expected) => {
    expect(rankFor(flat(RANK_MIN_SPOTS, evLoss))?.tier).toBe(expected);
  });

  it('treats each threshold as inclusive — exactly 0.42 has arrived at Grinder', () => {
    expect(rankFor(flat(RANK_MIN_SPOTS, 0.42))?.tier).toBe('Grinder');
    // and a hair worse is still Reg, so the boundary is not a rounding artefact
    expect(rankFor(flat(RANK_MIN_SPOTS, 0.4201))?.tier).toBe('Reg');
  });
});

describe('divisions climb within a tier', () => {
  /**
   * The deck shows `REG III` and `Grinder I` and, in 2f, "Grinder I — up from
   * Reg III". So III is the *top* of a tier and I is its entry, and the step
   * above Reg III is Grinder I rather than Reg II.
   *
   * The boundaries themselves the deck never states. Even thirds of each tier's
   * EV band is this repo's derivation, recorded in docs/05-ui-ux.md. The deck's
   * own sample figure (Reg III at 0.47) does not land where even thirds put it,
   * which is what mock data does — the structural claim above is the real one.
   */
  it('enters a tier at division I', () => {
    expect(rankFor(flat(RANK_MIN_SPOTS, 0.55))?.division).toBe(1);
  });

  it('reaches division III just before promotion', () => {
    // Reg spans 0.55 down to 0.42; the top third begins at 0.4633.
    expect(rankFor(flat(RANK_MIN_SPOTS, 0.43))).toMatchObject({ tier: 'Reg', division: 3 });
  });

  it('climbs I -> II -> III as EV loss falls', () => {
    const seen = [0.54, 0.48, 0.43].map((ev) => rankFor(flat(RANK_MIN_SPOTS, ev))?.division);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('gives Limper no division, because its band has no top', () => {
    expect(rankFor(flat(RANK_MIN_SPOTS, 5))).toMatchObject({ tier: 'Limper', division: undefined });
  });
});

describe('the rank moves down as well as up', () => {
  it('demotes when recent play gets worse', () => {
    const good = rankFor(flat(RANK_MIN_SPOTS, 0.25))?.tier;
    const worse = rankFor(flat(RANK_MIN_SPOTS, 0.6))?.tier;

    expect(good).toBe('Crusher');
    expect(worse).toBe('Limper');
  });

  it('reads only the most recent 200, so old answers stop counting', () => {
    /**
     * The regression this guards: averaging the whole history instead of the
     * window. Someone who played 400 terrible spots and then 200 excellent ones
     * is a Nemesis by the deck's rule and mid-table by a lifetime average.
     */
    const history = [...flat(400, 2), ...flat(RANK_MIN_SPOTS, 0.1)];

    expect(rankFor(history)?.tier).toBe('Nemesis');
  });

  it('takes the window from the end, not the start', () => {
    const history = [...flat(RANK_MIN_SPOTS, 0.1), ...flat(RANK_MIN_SPOTS, 2)];

    expect(rankFor(history)?.tier).toBe('Limper');
  });
});

describe('evLossPerSpot', () => {
  it('averages the window', () => {
    expect(evLossPerSpot(attempts([0.2, 0.4]))).toBeCloseTo(0.3, 10);
  });

  it('is zero for no attempts rather than NaN', () => {
    expect(evLossPerSpot([])).toBe(0);
  });

  it('reports the figure the UI prints, alongside the rank', () => {
    const rank = rankFor(flat(RANK_MIN_SPOTS, 0.47));
    expect(rank?.evLossPerSpot).toBeCloseTo(0.47, 10);
  });
});

describe('what it takes to climb', () => {
  it('names the next tier and the gap to it', () => {
    const rank = rankFor(flat(RANK_MIN_SPOTS, 0.47));

    expect(rank?.next).toMatchObject({ tier: 'Grinder', evLossPerSpot: 0.42 });
    // 2b prints exactly this: "You are 0.05 away over your last 200 answers."
    expect(rank?.next?.gap).toBeCloseTo(0.05, 10);
  });

  it('has nothing above Nemesis', () => {
    expect(rankFor(flat(RANK_MIN_SPOTS, 0.05))?.next).toBeUndefined();
  });
});
