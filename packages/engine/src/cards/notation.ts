/**
 * The 169 canonical starting hands and their concrete combos.
 *
 * Notation is fixed by .claude/skills/poker-domain/SKILL.md: `77` (pair, 6
 * combos), `AKs` (suited, 4), `AKo` (offsuit, 12). Ranks are written descending
 * with the higher card first — `AKo`, never `KAo` — and ten is always `T`.
 *
 * 13 pairs + 78 suited + 78 offsuit = 169, and their combos partition the
 * C(52,2) = 1326 two-card holdings exactly.
 */

import type { Card, Rank } from './card';
import { RANK_CHARS, SUIT_COUNT, makeCard, rankOf, suitOf } from './card';

/**
 * A canonical hand such as `"AA"`, `"AKs"`, `"AKo"`.
 *
 * Left as a plain string rather than a branded or template-literal type: these
 * are the keys of the range charts that Phase 2 loads from JSON, and a nominal
 * type would force a cast at every content boundary for no real safety.
 * `parseHandNotation` is the runtime gate instead.
 */
export type HandNotation = string;

/** Two distinct cards, higher card first. */
export type Combo = readonly [Card, Card];

export type HandKind = 'pair' | 'suited' | 'offsuit';

export interface ParsedHand {
  /** Rank of the higher card. */
  hi: Rank;
  /** Rank of the lower card; equal to `hi` for a pair. */
  lo: Rank;
  kind: HandKind;
}

function orderedCombo(a: Card, b: Card): Combo {
  return a > b ? [a, b] : [b, a];
}

/**
 * The 169 hands in 13x13 grid order: row-major, ranks descending, pairs on the
 * diagonal, suited above it and offsuit below. This is the order the Phase 6
 * range grid renders in, so producing it here keeps that component free of
 * poker logic.
 */
export const CANONICAL_HANDS: readonly HandNotation[] = Object.freeze(
  (() => {
    const hands: HandNotation[] = [];

    for (let row = 0; row < 13; row++) {
      for (let col = 0; col < 13; col++) {
        const rowRank = 12 - row;
        const colRank = 12 - col;

        if (row === col) {
          hands.push(`${RANK_CHARS[rowRank]!}${RANK_CHARS[rowRank]!}`);
        } else if (col > row) {
          hands.push(`${RANK_CHARS[rowRank]!}${RANK_CHARS[colRank]!}s`);
        } else {
          hands.push(`${RANK_CHARS[colRank]!}${RANK_CHARS[rowRank]!}o`);
        }
      }
    }

    return hands;
  })(),
);

export function parseHandNotation(text: string): ParsedHand {
  if (text.length !== 2 && text.length !== 3) {
    throw new SyntaxError(`expected a hand like "77", "AKs" or "AKo", got "${text}"`);
  }

  const hi = RANK_CHARS.indexOf(text[0]!);
  const lo = RANK_CHARS.indexOf(text[1]!);

  if (hi < 0 || lo < 0) {
    throw new SyntaxError(`"${text}" has an unknown rank (use one of ${RANK_CHARS})`);
  }

  if (text.length === 2) {
    if (hi !== lo) {
      throw new SyntaxError(`"${text}" is not a pair — it needs an "s" or "o" suffix`);
    }
    return { hi, lo, kind: 'pair' };
  }

  const suffix = text[2]!;
  if (suffix !== 's' && suffix !== 'o') {
    throw new SyntaxError(`"${text}" has an unknown suffix "${suffix}" — expected "s" or "o"`);
  }
  if (hi === lo) {
    throw new SyntaxError(`"${text}" is a pair, which is neither suited nor offsuit`);
  }
  if (hi < lo) {
    throw new SyntaxError(`"${text}" writes the lower card first — write it high card first`);
  }

  return { hi, lo, kind: suffix === 's' ? 'suited' : 'offsuit' };
}

/** 6 for a pair, 4 suited, 12 offsuit. */
export function comboCountOf(notation: HandNotation): number {
  switch (parseHandNotation(notation).kind) {
    case 'pair':
      return 6;
    case 'suited':
      return 4;
    case 'offsuit':
      return 12;
  }
}

export function combosOf(notation: HandNotation): readonly Combo[] {
  const { hi, lo, kind } = parseHandNotation(notation);
  const combos: Combo[] = [];

  if (kind === 'pair') {
    for (let a = 0; a < SUIT_COUNT; a++) {
      for (let b = a + 1; b < SUIT_COUNT; b++) {
        combos.push(orderedCombo(makeCard(hi, a), makeCard(hi, b)));
      }
    }
    return combos;
  }

  if (kind === 'suited') {
    for (let suit = 0; suit < SUIT_COUNT; suit++) {
      combos.push(orderedCombo(makeCard(hi, suit), makeCard(lo, suit)));
    }
    return combos;
  }

  for (let hiSuit = 0; hiSuit < SUIT_COUNT; hiSuit++) {
    for (let loSuit = 0; loSuit < SUIT_COUNT; loSuit++) {
      if (hiSuit === loSuit) continue;
      combos.push(orderedCombo(makeCard(hi, hiSuit), makeCard(lo, loSuit)));
    }
  }

  return combos;
}

/** The canonical hand two concrete cards belong to. Order independent. */
export function handNotationOf(a: Card, b: Card): HandNotation {
  if (a === b) {
    throw new RangeError('a hand needs two distinct cards');
  }

  const rankA = rankOf(a);
  const rankB = rankOf(b);
  const hi = Math.max(rankA, rankB);
  const lo = Math.min(rankA, rankB);

  if (hi === lo) {
    return `${RANK_CHARS[hi]!}${RANK_CHARS[lo]!}`;
  }

  return `${RANK_CHARS[hi]!}${RANK_CHARS[lo]!}${suitOf(a) === suitOf(b) ? 's' : 'o'}`;
}
