/**
 * Cards, encoded as dense integers 0..51.
 *
 * `card = rank * 4 + suit`, so `rank = card >>> 2` and `suit = card & 3`.
 *
 * Why an integer and not `{ rank, suit }`: the evaluator oracle run compares
 * two implementations over a million seven-card hands, and Monte Carlo equity
 * deals thousands of runouts per call. Object cards would allocate tens of
 * millions of times in those loops. The dense encoding also lets both the
 * evaluator and the equity code index plain arrays by card.
 *
 * `Card` is branded so a bare `Rank` cannot be passed where a `Card` is
 * expected. Both are numbers; without the brand that mix-up typechecks and
 * silently produces the wrong hand.
 */

/** 0 = deuce .. 12 = ace. */
export type Rank = number;

/** 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades. */
export type Suit = number;

/** An integer in [0, 52). Construct with `makeCard` or `parseCard`. */
export type Card = number & { readonly __card: 'Card' };

/** Indexed by rank value. Ranks ascend here; they are *written* descending. */
export const RANK_CHARS = '23456789TJQKA';

/** Indexed by suit value. */
export const SUIT_CHARS = 'cdhs';

export const RANK_COUNT = 13;
export const SUIT_COUNT = 4;
export const DECK_SIZE = RANK_COUNT * SUIT_COUNT;

export function makeCard(rank: Rank, suit: Suit): Card {
  if (!Number.isInteger(rank) || rank < 0 || rank >= RANK_COUNT) {
    throw new RangeError(`rank must be an integer in [0, 13), got ${rank}`);
  }
  if (!Number.isInteger(suit) || suit < 0 || suit >= SUIT_COUNT) {
    throw new RangeError(`suit must be an integer in [0, 4), got ${suit}`);
  }

  return ((rank << 2) | suit) as Card;
}

export function rankOf(card: Card): Rank {
  return card >>> 2;
}

export function suitOf(card: Card): Suit {
  return card & 3;
}

/** The 52 cards in encoding order, 2c first and As last. */
export const FULL_DECK: readonly Card[] = Object.freeze(
  Array.from({ length: DECK_SIZE }, (_value, i) => i as Card),
);

/**
 * Parses one card: an uppercase rank followed by a lowercase suit, e.g. `As`,
 * `Kh`, `7d`, `2c`. Strict on purpose — `10s`, `AS` and `as` are all rejected
 * rather than guessed at, because a silently misread card is undetectable
 * downstream.
 */
export function parseCard(text: string): Card {
  if (text.length !== 2) {
    throw new SyntaxError(`expected a two-character card like "As", got "${text}"`);
  }

  const rank = RANK_CHARS.indexOf(text[0]!);
  const suit = SUIT_CHARS.indexOf(text[1]!);

  if (rank < 0) {
    throw new SyntaxError(`unknown rank "${text[0]}" in "${text}" (use one of ${RANK_CHARS})`);
  }
  if (suit < 0) {
    throw new SyntaxError(`unknown suit "${text[1]}" in "${text}" (use one of ${SUIT_CHARS})`);
  }

  return makeCard(rank, suit);
}

export function formatCard(card: Card): string {
  return `${RANK_CHARS[rankOf(card)]!}${SUIT_CHARS[suitOf(card)]!}`;
}

/**
 * Parses a run of cards, with or without whitespace: `"AsKh7d"` and
 * `"As Kh 7d"` are the same. Duplicates are rejected — a hand or board holding
 * the same card twice is always a caller bug, and accepting it corrupts every
 * equity number computed from it.
 */
export function parseCards(text: string): Card[] {
  const compact = text.replace(/\s+/g, '');

  if (compact.length % 2 !== 0) {
    throw new SyntaxError(`"${text}" ends with half a card`);
  }

  const cards: Card[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < compact.length; i += 2) {
    const card = parseCard(compact.slice(i, i + 2));
    if (seen.has(card)) {
      throw new RangeError(`duplicate card ${formatCard(card)} in "${text}"`);
    }
    seen.add(card);
    cards.push(card);
  }

  return cards;
}

export function formatCards(cards: readonly Card[]): string {
  return cards.map(formatCard).join(' ');
}
