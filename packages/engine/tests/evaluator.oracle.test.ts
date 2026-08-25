import { describe, expect, it } from 'vitest';

import type { Card } from '../src/cards';
import { FULL_DECK, formatCards } from '../src/cards';
import {
  HandCategory,
  describeHandValue,
  evaluate,
  evaluateNaive,
  handCategoryName,
} from '../src/evaluator';
import type { Rng } from '../src/rng';
import { mulberry32 } from '../src/rng';

/**
 * The Phase 1 exit criterion, from docs/02-roadmap.md:
 *
 *   "Fast and naive evaluators agree on 1M random 7-card hands."
 *
 * docs/03-poker-engine.md explains why this test is the whole strategy: the
 * naive evaluator is slow and obviously correct, so any disagreement is a bug
 * in the fast one. Keeping the oracle in the repo turns "is my evaluator
 * right?" into something a machine answers.
 *
 * Tiered on purpose. The default sample keeps `pnpm test` at a couple of
 * seconds; the full million runs via `pnpm test:engine:exhaustive`, which CI
 * runs as its own step on every push, so the exit criterion is checked
 * continuously without taxing the local loop.
 *
 * Reading process.env here is legal despite the engine purity rules: the
 * `engine/purity` ESLint block is scoped to packages/engine/src, and
 * tsconfig.test.json supplies node types. The seeded-RNG ban is package-wide
 * and does apply — hence mulberry32 rather than Math.random.
 */

const DEFAULT_HANDS = 25_000;
const SEED = 0x5eed_1;

const handsToTest = Number(process.env.ENGINE_ORACLE_HANDS ?? DEFAULT_HANDS);

if (!Number.isInteger(handsToTest) || handsToTest < 1) {
  throw new Error(`ENGINE_ORACLE_HANDS must be a positive integer, got "${process.env.ENGINE_ORACLE_HANDS}"`);
}

/**
 * Partial Fisher-Yates over a persistent deck. Leaving the deck permuted
 * between deals is fine — every prefix is still a uniform sample — and avoids
 * rebuilding a 52-element array a million times.
 */
function makeDealer(rng: Rng): (count: number) => Card[] {
  const deck = [...FULL_DECK];

  return (count: number): Card[] => {
    for (let i = 0; i < count; i++) {
      const j = i + rng.nextInt(deck.length - i);
      const held = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = held;
    }
    return deck.slice(0, count);
  };
}

function reportMismatch(index: number, cards: readonly Card[], fast: number, slow: number): never {
  const show = (value: number): string => {
    const { category, tiebreakers } = describeHandValue(value);
    return `${handCategoryName(category)} [${tiebreakers.join(', ')}] (0x${value.toString(16)})`;
  };

  throw new Error(
    [
      `Evaluators disagreed at hand ${index} of ${handsToTest}.`,
      `  cards: ${formatCards(cards)}`,
      `  fast:  ${show(fast)}`,
      `  naive: ${show(slow)}`,
      `  repro: seed ${SEED}, ENGINE_ORACLE_HANDS=${handsToTest}`,
      'The naive evaluator is the oracle — the bug is in the fast one.',
    ].join('\n'),
  );
}

describe('fast evaluator against the naive oracle', () => {
  it(`agrees on ${handsToTest.toLocaleString('en-US')} random seven-card hands`, () => {
    const deal = makeDealer(mulberry32(SEED));
    const categoriesSeen = new Set<HandCategory>();

    for (let i = 0; i < handsToTest; i++) {
      const cards = deal(7);
      const fast = evaluate(cards);
      const slow = evaluateNaive(cards);

      if (fast !== slow) reportMismatch(i, cards, fast, slow);

      categoriesSeen.add(describeHandValue(fast).category);
    }

    // Agreement over a sample that never produced a straight flush would not
    // say much. Assert the sample actually reached every category.
    const missing = Object.values(HandCategory)
      .filter((c) => !categoriesSeen.has(c))
      .map(handCategoryName);

    expect(missing, `sample of ${handsToTest} hands never produced: ${missing.join(', ')}`).toEqual(
      [],
    );
  }, 900_000);

  it('agrees on random five- and six-card hands', () => {
    // Seven cards is what the game deals, but both evaluators accept five and
    // six, and the fast one takes different paths through the count loop when
    // there are fewer cards to group.
    const deal = makeDealer(mulberry32(SEED + 1));
    const sample = Math.min(handsToTest, 50_000);

    for (const size of [5, 6]) {
      for (let i = 0; i < sample; i++) {
        const cards = deal(size);
        const fast = evaluate(cards);
        const slow = evaluateNaive(cards);

        if (fast !== slow) reportMismatch(i, cards, fast, slow);
      }
    }
  }, 300_000);

  it('agrees on every hand drawn from a deliberately collision-heavy deck', () => {
    // Random seven-card hands almost never contain quads, two sets of trips, or
    // a flush alongside a straight. Restricting the deck to a few ranks makes
    // those the common case instead of the tail.
    const narrowDeck = FULL_DECK.filter((card) => card >>> 2 <= 4);
    const rng = mulberry32(SEED + 2);

    for (let i = 0; i < 30_000; i++) {
      const deck = [...narrowDeck];
      for (let k = 0; k < 7; k++) {
        const j = k + rng.nextInt(deck.length - k);
        const held = deck[k]!;
        deck[k] = deck[j]!;
        deck[j] = held;
      }

      const cards = deck.slice(0, 7);
      const fast = evaluate(cards);
      const slow = evaluateNaive(cards);

      if (fast !== slow) reportMismatch(i, cards, fast, slow);
    }
  }, 120_000);
});
