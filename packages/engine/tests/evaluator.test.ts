import { describe, expect, it } from 'vitest';

import { formatCards, parseCards } from '../src/cards';
import {
  HandCategory,
  compareHandValues,
  describeHandValue,
  evaluate,
  evaluateNaive,
  handCategoryName,
} from '../src/evaluator';
import { mulberry32, shuffle } from '../src/rng';

/**
 * docs/03-poker-engine.md: "Additional invariants worth asserting: evaluation is
 * order-independent; ranking is a total order; known hand comparisons hold (a
 * wheel straight beats trips, a straight flush beats quads)."
 *
 * Everything here runs against BOTH evaluators. The million-hand oracle test in
 * evaluator.oracle.test.ts proves they agree with each other; these cases prove
 * what they agree *on*. Two evaluators can agree perfectly and both be wrong.
 */

const IMPLEMENTATIONS = [
  ['fast', evaluate],
  ['naive', evaluateNaive],
] as const;

function rank(text: string): number {
  return evaluate(parseCards(text));
}

describe.each(IMPLEMENTATIONS)('%s evaluator', (_name, evaluateWith) => {
  function categoryOf(text: string) {
    return describeHandValue(evaluateWith(parseCards(text))).category;
  }

  function describeOf(text: string) {
    return describeHandValue(evaluateWith(parseCards(text)));
  }

  it.each([
    ['royal flush', 'As Ks Qs Js Ts', HandCategory.StraightFlush],
    ['steel wheel', '5s 4s 3s 2s As', HandCategory.StraightFlush],
    ['quads', '7c 7d 7h 7s 2c', HandCategory.Quads],
    ['full house', '7c 7d 7h 2c 2d', HandCategory.FullHouse],
    ['flush', 'As Qs Ts 5s 3s', HandCategory.Flush],
    ['straight', '9c 8d 7h 6s 5c', HandCategory.Straight],
    ['wheel', '5c 4d 3h 2s Ac', HandCategory.Straight],
    ['trips', '7c 7d 7h 2c 3d', HandCategory.Trips],
    ['two pair', '7c 7d 2h 2c 3d', HandCategory.TwoPair],
    ['one pair', '7c 7d 9h 2c 3d', HandCategory.Pair],
    ['high card', 'Ac Kd 9h 7c 3d', HandCategory.HighCard],
  ])('reads %s from %s', (_label, text, category) => {
    expect(categoryOf(text)).toBe(category);
  });

  it('ranks the wheel as a five-high straight, not an ace-high one', () => {
    const wheel = describeOf('5c 4d 3h 2s Ac');

    expect(wheel.category).toBe(HandCategory.Straight);
    // Rank 3 is the five. An implementation that let the ace play high here
    // would report 12 and rate the wheel as the best straight in the game.
    expect(wheel.tiebreakers).toEqual([3]);
    expect(evaluateWith(parseCards('5c 4d 3h 2s Ac'))).toBeLessThan(
      evaluateWith(parseCards('6c 5d 4h 3s 2c')),
    );
  });

  it('does not invent a straight from A K Q J with a wrap to 2', () => {
    expect(categoryOf('Ac Kd Qh Js 2c')).toBe(HandCategory.HighCard);
  });

  it('reads the best five of seven', () => {
    // The board plays: hole cards cannot improve on a board straight flush.
    expect(describeOf('As Ks Qs Js Ts 2c 7d').category).toBe(HandCategory.StraightFlush);
    // Two trips make a full house of the higher one.
    expect(describeOf('7c 7d 7h 8c 8d 8h 2c')).toEqual({
      category: HandCategory.FullHouse,
      tiebreakers: [6, 5],
    });
    // Quads plus trips: the kicker is the eight, which is not a singleton.
    expect(describeOf('7c 7d 7h 7s 8c 8d 2c')).toEqual({
      category: HandCategory.Quads,
      tiebreakers: [5, 6],
    });
    // Three pairs: only the top two play, and the third pair supplies the kicker.
    expect(describeOf('Ac Ad Kc Kd Qc Qd 2c')).toEqual({
      category: HandCategory.TwoPair,
      tiebreakers: [12, 11, 10],
    });
  });

  it('is order independent', () => {
    const rng = mulberry32(4242);
    const cards = parseCards('As Ks Qh Jd Tc 9c 2d');
    const expected = evaluateWith(cards);

    for (let i = 0; i < 200; i++) {
      expect(evaluateWith(shuffle(rng, cards))).toBe(expected);
    }
  });

  it.each([4, 8])('rejects a hand of %i cards', (count) => {
    const cards = parseCards('As Ks Qs Js Ts 9s 8s 7s').slice(0, count);

    expect(() => evaluateWith(cards)).toThrow(RangeError);
  });

  it('accepts five, six and seven cards', () => {
    const seven = parseCards('As Ks Qs Js Ts 9s 8s');

    expect(() => evaluateWith(seven.slice(0, 5))).not.toThrow();
    expect(() => evaluateWith(seven.slice(0, 6))).not.toThrow();
    expect(() => evaluateWith(seven)).not.toThrow();
  });
});

describe('ordering', () => {
  // docs/03-poker-engine.md names these two explicitly.
  it('ranks a straight flush above quads', () => {
    expect(rank('5s 4s 3s 2s As')).toBeGreaterThan(rank('Ac Ad Ah As Kc'));
  });

  it('ranks a wheel straight above trips', () => {
    expect(rank('5c 4d 3h 2s Ac')).toBeGreaterThan(rank('Ac Ad Ah Kc Qd'));
  });

  it('is a total order across every category', () => {
    const ascending = [
      'Ac Kd 9h 7c 3d', // high card
      '2c 2d 9h 7c 3d', // pair
      'Ac Ad 9h 7c 3d', // better pair
      '2c 2d 3h 3c 9d', // two pair
      'Ac Ad Kh Kc 9d', // better two pair
      '2c 2d 2h 7c 3d', // trips
      '5c 4d 3h 2s Ac', // wheel
      '9c 8d 7h 6s 5c', // straight
      'Ac Kd Qh Js Tc', // broadway
      '2s 5s 7s 9s Js', // flush
      '2c 2d 2h 3c 3d', // full house
      'Ac Ad Ah Kc Kd', // better full house
      '2c 2d 2h 2s 3d', // quads
      '5s 4s 3s 2s As', // steel wheel
      'As Ks Qs Js Ts', // royal
    ];

    const values = ascending.map(rank);

    for (let i = 1; i < values.length; i++) {
      expect(compareHandValues(values[i]!, values[i - 1]!)).toBeGreaterThan(0);
    }
  });

  it('separates hands by kicker', () => {
    expect(rank('Ac Ad Kh Qc Jd')).toBeGreaterThan(rank('Ac Ad Kh Qc Td'));
    expect(rank('Ac Ad Kh Qc Jd')).toBe(rank('As Ah Ks Qs Js'));
  });

  it('separates flushes by their fifth card', () => {
    expect(rank('As Ks Qs Js 9s')).toBeGreaterThan(rank('Ah Kh Qh Jh 8h'));
  });

  it('treats a deuce kicker as a real card, not a missing one', () => {
    // Rank 0 is the deuce. Packing it as an absent tiebreaker would make these
    // two hands compare equal.
    expect(rank('Ac Kd Qh Jc 2d')).toBeGreaterThan(rank('Ac Kd Qh Tc 9d'));
    expect(describeHandValue(rank('Ac Kd Qh Jc 2d')).tiebreakers).toEqual([12, 11, 10, 9, 0]);
  });

  it('ties identical hands of different suits', () => {
    expect(rank('Ac Kc Qc Jc 9c')).toBe(rank('Ah Kh Qh Jh 9h'));
  });
});

describe('describeHandValue', () => {
  it('reports the right number of tiebreakers per category', () => {
    const arities: Array<[string, number]> = [
      ['Ac Kd 9h 7c 3d', 5], // high card
      ['2c 2d 9h 7c 3d', 4], // pair
      ['2c 2d 3h 3c 9d', 3], // two pair
      ['2c 2d 2h 7c 3d', 3], // trips
      ['9c 8d 7h 6s 5c', 1], // straight
      ['2s 5s 7s 9s Js', 5], // flush
      ['2c 2d 2h 3c 3d', 2], // full house
      ['2c 2d 2h 2s 3d', 2], // quads
      ['As Ks Qs Js Ts', 1], // straight flush
    ];

    for (const [text, arity] of arities) {
      expect(describeHandValue(rank(text)).tiebreakers).toHaveLength(arity);
    }
  });

  it('names every category', () => {
    for (const category of Object.values(HandCategory)) {
      expect(handCategoryName(category)).toMatch(/\w/);
    }
  });
});

describe('fast and naive agree on the fixtures', () => {
  it.each([
    'As Ks Qs Js Ts 2c 7d',
    '7c 7d 7h 7s 8c 8d 2c',
    '5s 4s 3s 2s As Kh Qd',
    'Ac Ad Kc Kd Qc Qd 2c',
    '2c 3d 4h 5s 6c 7d 8h',
    'Ac Kd Qh Js 2c 3d 4h',
  ])('%s', (text) => {
    const cards = parseCards(text);

    expect(evaluate(cards)).toBe(evaluateNaive(cards));
    // Guards the fixture itself: a typo producing fewer than seven cards would
    // otherwise make this pass vacuously.
    expect(formatCards(cards).split(' ')).toHaveLength(7);
  });
});
