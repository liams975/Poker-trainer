/**
 * The shared encoding both evaluators produce.
 *
 * A `HandValue` packs the hand category and up to five tiebreaker ranks into a
 * single 24-bit integer, so comparison is subtraction and equality is `===`.
 *
 *   category << 20 | t1 << 16 | t2 << 12 | t3 << 8 | t4 << 4 | t5
 *
 * Both the naive and the fast evaluator return the *same* packed value, not
 * merely values that sort the same way. That is the load-bearing choice in this
 * module: two evaluators can agree on every pairwise comparison while
 * disagreeing about what the hand actually is, and only exact equality catches
 * that. The oracle test asserts equality, not ordering.
 */

export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;

export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory];

/** Packed hand strength. Higher is better; compare with `-` or `<`. */
export type HandValue = number;

const CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'high card',
  [HandCategory.Pair]: 'pair',
  [HandCategory.TwoPair]: 'two pair',
  [HandCategory.Trips]: 'three of a kind',
  [HandCategory.Straight]: 'straight',
  [HandCategory.Flush]: 'flush',
  [HandCategory.FullHouse]: 'full house',
  [HandCategory.Quads]: 'four of a kind',
  [HandCategory.StraightFlush]: 'straight flush',
};

/**
 * How many tiebreakers each category actually uses.
 *
 * Needed because trailing zeros cannot be trimmed: rank 0 is the deuce, so a
 * high-card hand ending in a deuce has a genuine zero in its last slot.
 */
const TIEBREAKER_ARITY: Record<HandCategory, number> = {
  [HandCategory.HighCard]: 5,
  [HandCategory.Pair]: 4,
  [HandCategory.TwoPair]: 3,
  [HandCategory.Trips]: 3,
  [HandCategory.Straight]: 1,
  [HandCategory.Flush]: 5,
  [HandCategory.FullHouse]: 2,
  [HandCategory.Quads]: 2,
  [HandCategory.StraightFlush]: 1,
};

/**
 * Positional rather than variadic: this sits in the inner loop of both
 * evaluators, and a rest parameter would allocate an array per call.
 */
export function packHandValue(
  category: HandCategory,
  t1 = 0,
  t2 = 0,
  t3 = 0,
  t4 = 0,
  t5 = 0,
): HandValue {
  return (category << 20) | (t1 << 16) | (t2 << 12) | (t3 << 8) | (t4 << 4) | t5;
}

export interface DescribedHand {
  category: HandCategory;
  /** Ranks in decreasing significance, trimmed to the category's arity. */
  tiebreakers: number[];
}

export function describeHandValue(value: HandValue): DescribedHand {
  const category = ((value >>> 20) & 0xf) as HandCategory;
  const all = [
    (value >>> 16) & 0xf,
    (value >>> 12) & 0xf,
    (value >>> 8) & 0xf,
    (value >>> 4) & 0xf,
    value & 0xf,
  ];

  return { category, tiebreakers: all.slice(0, TIEBREAKER_ARITY[category]) };
}

/** Negative if `a` is worse, positive if better, zero if the hands tie. */
export function compareHandValues(a: HandValue, b: HandValue): number {
  return a - b;
}

export function handCategoryName(category: HandCategory): string {
  return CATEGORY_NAMES[category];
}
