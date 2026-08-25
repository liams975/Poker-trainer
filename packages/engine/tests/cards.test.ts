import { describe, expect, it } from 'vitest';

import {
  DECK_SIZE,
  FULL_DECK,
  RANK_CHARS,
  SUIT_CHARS,
  formatCard,
  formatCards,
  requireDistinctCards,
  makeCard,
  parseCard,
  parseCards,
  rankOf,
  suitOf,
} from '../src/cards';

/**
 * docs/03-poker-engine.md, test plan: "Round-trip parse/serialize."
 *
 * The notation rules are fixed by .claude/skills/poker-domain/SKILL.md: ranks
 * descend A K Q J T 9 8 7 6 5 4 3 2, always `T` and never `10`; a card is an
 * uppercase rank followed by a lowercase suit.
 */

describe('deck', () => {
  it('has 52 cards', () => {
    expect(FULL_DECK).toHaveLength(52);
    expect(DECK_SIZE).toBe(52);
  });

  it('has no duplicates', () => {
    expect(new Set(FULL_DECK).size).toBe(52);
  });

  it('covers every rank/suit pair exactly once', () => {
    const seen = new Set(FULL_DECK.map((c) => `${rankOf(c)}:${suitOf(c)}`));

    expect(seen.size).toBe(52);
    for (let r = 0; r < 13; r++) {
      for (let s = 0; s < 4; s++) {
        expect(seen.has(`${r}:${s}`)).toBe(true);
      }
    }
  });

  it('occupies exactly the integers 0..51', () => {
    // The evaluator and equity hot paths index arrays by card, so the encoding
    // being dense and zero-based is load-bearing, not incidental.
    expect([...FULL_DECK].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 52 }, (_v, i) => i),
    );
  });
});

describe('rank and suit accessors', () => {
  it('round-trip through makeCard', () => {
    for (let r = 0; r < 13; r++) {
      for (let s = 0; s < 4; s++) {
        const card = makeCard(r, s);
        expect(rankOf(card)).toBe(r);
        expect(suitOf(card)).toBe(s);
      }
    }
  });

  it('orders ranks ascending from deuce to ace', () => {
    expect(rankOf(parseCard('2c'))).toBe(0);
    expect(rankOf(parseCard('Tc'))).toBe(8);
    expect(rankOf(parseCard('Ac'))).toBe(12);
    expect(rankOf(parseCard('Kc'))).toBeLessThan(rankOf(parseCard('Ac')));
  });

  it.each([
    [-1, 0],
    [13, 0],
    [0, -1],
    [0, 4],
    [1.5, 0],
  ])('rejects makeCard(%s, %s)', (r, s) => {
    expect(() => makeCard(r, s)).toThrow(RangeError);
  });
});

describe('parseCard', () => {
  it('round-trips every card in the deck', () => {
    for (const card of FULL_DECK) {
      expect(parseCard(formatCard(card))).toBe(card);
    }
  });

  it('round-trips every valid text form', () => {
    for (const r of RANK_CHARS) {
      for (const s of SUIT_CHARS) {
        expect(formatCard(parseCard(`${r}${s}`))).toBe(`${r}${s}`);
      }
    }
  });

  it('reads the documented examples', () => {
    expect(formatCard(parseCard('As'))).toBe('As');
    expect(formatCard(parseCard('Kh'))).toBe('Kh');
    expect(formatCard(parseCard('7d'))).toBe('7d');
    expect(formatCard(parseCard('2c'))).toBe('2c');
  });

  it.each([
    ['10s', 'ten written long instead of T'],
    ['AS', 'uppercase suit'],
    ['as', 'lowercase rank'],
    ['Zx', 'nonsense'],
    ['A', 'missing suit'],
    ['Ass', 'trailing character'],
    ['', 'empty'],
    ['1s', 'there is no rank 1'],
    [' As', 'leading space'],
  ])('rejects %s (%s)', (text) => {
    expect(() => parseCard(text)).toThrow();
  });
});

describe('parseCards', () => {
  it('reads a run of cards with no separator', () => {
    expect(formatCards(parseCards('AsKh7d'))).toBe('As Kh 7d');
  });

  it('reads a space-separated run', () => {
    expect(formatCards(parseCards('As Kh 7d'))).toBe('As Kh 7d');
  });

  it('reads the empty string as no cards', () => {
    expect(parseCards('')).toEqual([]);
  });

  it('rejects a partial trailing card', () => {
    expect(() => parseCards('AsK')).toThrow();
  });

  it('rejects duplicate cards', () => {
    // A hand or board containing the same card twice is always a bug in the
    // caller, and silently accepting it corrupts every equity number downstream.
    expect(() => parseCards('AsAs')).toThrow();
    expect(() => parseCards('AsKh As')).toThrow();
  });
});

describe('requireDistinctCards', () => {
  // Moved here from equity/showdown.ts in Phase 3a: it is a cards concern, and
  // game/ needed it without depending on equity to validate cards.
  it('accepts distinct cards', () => {
    expect(() => requireDistinctCards(parseCards('As Kh 7d 2c'))).not.toThrow();
    expect(() => requireDistinctCards([])).not.toThrow();
  });

  it('rejects a repeat and names the card', () => {
    const cards = [...parseCards('As Kh'), parseCard('As')];

    expect(() => requireDistinctCards(cards)).toThrow(/As/);
  });

  it('catches a repeat anywhere in the sequence', () => {
    const cards = [...parseCards('As Kh 7d 2c'), parseCard('7d')];

    expect(() => requireDistinctCards(cards)).toThrow(RangeError);
  });
});
