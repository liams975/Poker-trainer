import { describe, expect, it } from 'vitest';

import {
  CANONICAL_HANDS,
  FULL_DECK,
  combosOf,
  comboCountOf,
  formatCard,
  handNotationOf,
  parseCard,
  parseHandNotation,
} from '../src/cards';

/**
 * docs/03-poker-engine.md, test plan: "Exactly 169 canonical hands. Combo
 * counts: 6 for pairs, 4 suited, 12 offsuit."
 *
 * The 169 decomposes as 13 pairs + 78 suited + 78 offsuit
 * (.claude/skills/poker-domain/SKILL.md), and the combos across all of them
 * must account for every one of the C(52,2) = 1326 two-card holdings exactly
 * once. That bijection is the real assertion here — the counts alone would pass
 * for an implementation that emitted the wrong combos in the right quantity.
 */

function comboKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

describe('the 169 canonical hands', () => {
  it('has exactly 169 entries, all distinct', () => {
    expect(CANONICAL_HANDS).toHaveLength(169);
    expect(new Set(CANONICAL_HANDS).size).toBe(169);
  });

  it('decomposes as 13 pairs + 78 suited + 78 offsuit', () => {
    const pairs = CANONICAL_HANDS.filter((h) => h.length === 2);
    const suited = CANONICAL_HANDS.filter((h) => h.endsWith('s'));
    const offsuit = CANONICAL_HANDS.filter((h) => h.endsWith('o'));

    expect(pairs).toHaveLength(13);
    expect(suited).toHaveLength(78);
    expect(offsuit).toHaveLength(78);
  });

  it('writes the higher card first, always', () => {
    for (const hand of CANONICAL_HANDS) {
      const { hi, lo } = parseHandNotation(hand);
      expect(hi).toBeGreaterThanOrEqual(lo);
    }

    expect(CANONICAL_HANDS).toContain('AKo');
    expect(CANONICAL_HANDS).not.toContain('KAo');
  });

  it('uses T, never 10', () => {
    expect(CANONICAL_HANDS).toContain('T9s');
    expect(CANONICAL_HANDS.some((h) => h.includes('10'))).toBe(false);
  });

  it('has no suited or offsuit pairs', () => {
    expect(CANONICAL_HANDS).not.toContain('AAs');
    expect(CANONICAL_HANDS).not.toContain('AAo');
    expect(CANONICAL_HANDS).toContain('AA');
  });
});

describe('combo counts', () => {
  it.each([
    ['AA', 6],
    ['77', 6],
    ['22', 6],
    ['AKs', 4],
    ['72s', 4],
    ['AKo', 12],
    ['72o', 12],
  ])('%s has %i combos', (hand, count) => {
    expect(comboCountOf(hand)).toBe(count);
    expect(combosOf(hand)).toHaveLength(count);
  });

  it('totals 1326 combos across all 169 hands', () => {
    const total = CANONICAL_HANDS.reduce((sum, h) => sum + comboCountOf(h), 0);

    expect(total).toBe(1326);
  });
});

describe('combos partition the deck', () => {
  it('covers every two-card holding exactly once', () => {
    const seen = new Set<string>();

    for (const hand of CANONICAL_HANDS) {
      for (const [a, b] of combosOf(hand)) {
        const key = comboKey(a, b);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }

    const everyHolding = new Set<string>();
    for (let i = 0; i < FULL_DECK.length; i++) {
      for (let j = i + 1; j < FULL_DECK.length; j++) {
        everyHolding.add(comboKey(FULL_DECK[i]!, FULL_DECK[j]!));
      }
    }

    expect(everyHolding.size).toBe(1326);
    expect(seen).toEqual(everyHolding);
  });

  it('never emits a combo containing the same card twice', () => {
    for (const hand of CANONICAL_HANDS) {
      for (const [a, b] of combosOf(hand)) {
        expect(a).not.toBe(b);
      }
    }
  });

  it('emits combos whose notation is the hand they came from', () => {
    for (const hand of CANONICAL_HANDS) {
      for (const [a, b] of combosOf(hand)) {
        expect(handNotationOf(a, b)).toBe(hand);
      }
    }
  });

  it('matches suitedness to the notation', () => {
    for (const hand of CANONICAL_HANDS) {
      const suited = hand.endsWith('s');
      for (const [a, b] of combosOf(hand)) {
        expect((a & 3) === (b & 3)).toBe(suited);
      }
    }
  });
});

describe('handNotationOf', () => {
  it('is order independent', () => {
    for (let i = 0; i < FULL_DECK.length; i++) {
      for (let j = i + 1; j < FULL_DECK.length; j++) {
        const a = FULL_DECK[i]!;
        const b = FULL_DECK[j]!;
        expect(handNotationOf(a, b)).toBe(handNotationOf(b, a));
      }
    }
  });

  it('names the documented examples', () => {
    expect(handNotationOf(parseCard('Ah'), parseCard('Kh'))).toBe('AKs');
    expect(handNotationOf(parseCard('Ah'), parseCard('Ks'))).toBe('AKo');
    expect(handNotationOf(parseCard('7c'), parseCard('7d'))).toBe('77');
    // Written high card first even when handed low card first.
    expect(handNotationOf(parseCard('Kh'), parseCard('Ah'))).toBe('AKs');
  });

  it('rejects a pair of identical cards', () => {
    const as = parseCard('As');
    expect(() => handNotationOf(as, as)).toThrow();
  });

  it('always yields a member of the canonical 169', () => {
    for (let i = 0; i < FULL_DECK.length; i++) {
      for (let j = i + 1; j < FULL_DECK.length; j++) {
        expect(CANONICAL_HANDS).toContain(handNotationOf(FULL_DECK[i]!, FULL_DECK[j]!));
      }
    }
  });
});

describe('parseHandNotation', () => {
  it('reads the three forms', () => {
    expect(parseHandNotation('77')).toEqual({ hi: 5, lo: 5, kind: 'pair' });
    expect(parseHandNotation('AKs')).toEqual({ hi: 12, lo: 11, kind: 'suited' });
    expect(parseHandNotation('AKo')).toEqual({ hi: 12, lo: 11, kind: 'offsuit' });
  });

  it.each([
    ['AAs', 'a pair cannot be suited'],
    ['AAo', 'a pair cannot be offsuit'],
    ['KAo', 'low card written first'],
    ['AKx', 'unknown suffix'],
    ['AK', 'missing suffix on a non-pair'],
    ['A', 'too short'],
    ['', 'empty'],
    ['aks', 'lowercase ranks'],
    ['AKS', 'uppercase suffix'],
    ['T10s', 'ten written long'],
  ])('rejects %s (%s)', (text) => {
    expect(() => parseHandNotation(text)).toThrow();
  });

  it('round-trips every canonical hand', () => {
    for (const hand of CANONICAL_HANDS) {
      const parsed = parseHandNotation(hand);
      const combos = combosOf(hand);
      const [a, b] = combos[0]!;

      expect(Math.max(a >>> 2, b >>> 2)).toBe(parsed.hi);
      expect(Math.min(a >>> 2, b >>> 2)).toBe(parsed.lo);
    }
  });
});

describe('formatCard round-trip against notation', () => {
  it('produces combos that re-parse', () => {
    for (const [a, b] of combosOf('AKs')) {
      expect(parseCard(formatCard(a))).toBe(a);
      expect(parseCard(formatCard(b))).toBe(b);
    }
  });
});
