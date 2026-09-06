import { describe, expect, it } from 'vitest';

import { parseCards } from '../src/cards';
import type { Combo } from '../src/cards';
import {
  applyAction,
  boardCardsNeeded,
  createHandState,
  dealBoard,
  legalActions,
} from '../src/game';
import type { HandState } from '../src/game';
import type { Position } from '../src/ranges';
import { frequencySum } from '../src/ranges';
import { mulberry32 } from '../src/rng';
import { HEURISTIC_VERSION, createHeuristicStrategy } from '../src/strategy';

/**
 * The bot's brain, and the line this phase must not cross.
 *
 * `heuristics.ts` refused to ship a decision-making strategy in Phase 3, and
 * the reason it gave is exact: "A crude postflop strategy would be able to
 * *grade* a user, and grading someone against invented postflop logic teaches
 * wrong play."
 *
 * Phase 12a narrows that refusal to its actual reason rather than reversing it.
 * What is forbidden is *grading* against invented logic. An opponent that
 * *plays* by invented logic is just an opponent — every poker bot ever written
 * is invented logic, and nobody is being told their play was wrong.
 *
 * So what this file pins is not "the bot plays well". It is:
 *
 *   1. Every recommendation is **legal**, so a bot can never be asked to do
 *      something the betting rules reject.
 *   2. Frequencies are a real distribution, summing to 1.
 *   3. It is **deterministic** for a seed.
 *   4. It marks itself `source: 'heuristic'` and carries `HEURISTIC_VERSION`
 *      rather than a chart version, so a heuristic recommendation that ever
 *      reached `drill_attempts.chart_version` would be visible in the data
 *      instead of looking like a real chart.
 *
 * Playing *well* is not testable here and is not claimed anywhere.
 */

function combo(text: string): Combo {
  const [a, b] = parseCards(text);
  return [a!, b!];
}

const strategy = (seed = 1) =>
  createHeuristicStrategy({ rng: mulberry32(seed), trials: 60 });

/** Folds to the button, who opens; the big blind calls; flop comes down. */
function flopHeadsUp(board: string): HandState {
  let state = createHandState({
    hole: { BTN: combo('Ah Kd'), BB: combo('7c 2d') },
  });
  for (let i = 0; i < 3; i++) state = applyAction(state, 'fold'); // UTG, HJ, CO
  state = applyAction(state, 'raise', 2.5); // BTN
  state = applyAction(state, 'fold'); // SB
  state = applyAction(state, 'call'); // BB
  return dealBoard(state, parseCards(board));
}

describe('createHeuristicStrategy — the contract', () => {
  it('only ever recommends legal actions', () => {
    // Walked over a real hand rather than one hand-built state: the shapes that
    // break this are the awkward ones — facing an all-in for less, a stack too
    // short to raise — and they only arise mid-hand.
    let state = createHandState({ stacks: { CO: 3 } });
    const bot = strategy();

    for (let step = 0; step < 20 && state.toAct !== undefined; step++) {
      const hero = state.toAct;
      const seat = state.seats.find((s) => s.position === hero)!;
      if (seat.hole === undefined) {
        state = applyAction(state, 'fold');
        continue;
      }

      const legal = legalActions(state);
      const recommendation = bot.recommend(state, hero);

      for (const entry of recommendation.frequencies) {
        expect(
          legal.some((option) => option.action === entry.action),
          `${hero} was offered an illegal ${entry.action} on the ${state.street}`,
        ).toBe(true);
      }

      state = applyAction(state, 'fold');
    }
  });

  it('returns a real distribution', () => {
    const state = flopHeadsUp('As 9h 2c');
    const recommendation = strategy().recommend(state, state.toAct as Position);

    expect(recommendation.frequencies.length).toBeGreaterThan(0);
    expect(frequencySum(recommendation.frequencies)).toBeCloseTo(1, 6);
    for (const entry of recommendation.frequencies) {
      expect(entry.freq).toBeGreaterThan(0);
      expect(entry.freq).toBeLessThanOrEqual(1);
    }
  });

  it('names itself a heuristic, and does not claim a chart version', () => {
    const state = flopHeadsUp('As 9h 2c');
    const recommendation = strategy().recommend(state, state.toAct as Position);

    expect(recommendation.source).toBe('heuristic');
    expect(recommendation.chartVersion).toBe(HEURISTIC_VERSION);
    // Not a version string. A chart set is dated (`2026.08.25-1`); this must
    // never be mistakable for one if it turns up in a stored row.
    expect(recommendation.chartVersion).not.toMatch(/^\d{4}\./);
  });

  it('carries structured rationale, not prose', () => {
    // docs/03: "Rationale must be structured data, not a string." 12b renders
    // *why the bot did that* from this without touching the engine.
    const state = flopHeadsUp('As 9h 2c');
    const { rationale } = strategy().recommend(state, state.toAct as Position);

    expect(Array.isArray(rationale.factors)).toBe(true);
    expect(rationale.factors.length).toBeGreaterThan(0);
    for (const item of rationale.factors) {
      expect(typeof item.kind).toBe('string');
    }
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const state = flopHeadsUp('As 9h 2c');

    const once = strategy(42).recommend(state, state.toAct as Position);
    const again = strategy(42).recommend(state, state.toAct as Position);

    expect(again.frequencies).toEqual(once.frequencies);

    // Different seeds sample different runouts, so the equity — and with it the
    // distribution — should not land identically every time.
    const other = strategy(1234).recommend(state, state.toAct as Position);
    expect(other.frequencies).not.toEqual(once.frequencies);
  });

  it('refuses a seat that is not acting', () => {
    const state = createHandState({ hole: { UTG: combo('Ah Kd') } });

    expect(() => strategy().recommend(state, 'CO')).toThrow(/turn/i);
  });

  it('refuses a seat holding no cards', () => {
    const state = createHandState();

    expect(() => strategy().recommend(state, 'UTG')).toThrow(/cards/i);
  });
});

describe('createHeuristicStrategy — that it responds to the spot at all', () => {
  /**
   * Not "plays well" — that is untestable and unclaimed. Only that the inputs
   * reach the output, so a strategy that ignored its own measurements and
   * returned a constant would fail.
   *
   * These use a high trial count on purpose. At the 60 runouts the contract
   * tests use, equity swings a few points between seeds and a threshold this
   * tight fails on noise rather than on behaviour — which is how the first
   * draft of this file failed.
   */
  const careful = () => createHeuristicStrategy({ rng: mulberry32(5), trials: 1200 });

  /** The big blind facing a raise of `raiseTo` while holding `hole`. */
  function facingRaise(hole: Combo, raiseTo: number): HandState {
    let state = createHandState({ hole: { BTN: combo('9c 4d'), BB: hole } });
    for (let i = 0; i < 3; i++) state = applyAction(state, 'fold'); // UTG, HJ, CO
    state = applyAction(state, 'raise', raiseTo); // BTN
    state = applyAction(state, 'fold'); // SB
    return state;
  }

  const foldWeight = (state: HandState): number =>
    frequencySum(
      careful()
        .recommend(state, 'BB')
        .frequencies.filter((entry) => entry.action === 'fold'),
    );

  it('folds a weak hand more often than a strong one at the same price', () => {
    const strong = foldWeight(facingRaise(combo('Ah Ad'), 12));
    const weak = foldWeight(facingRaise(combo('7c 2d'), 12));

    expect(weak, 'seven-deuce should fold more than aces').toBeGreaterThan(strong);
    expect(strong, 'aces should almost never fold for 12bb').toBeLessThan(0.05);
  });

  it('continues more readily at a better price', () => {
    // The same hand, twice: getting 3.5-to-1.5, and getting almost nothing.
    const cheap = foldWeight(facingRaise(combo('Qs Jh'), 2.5));
    const dear = foldWeight(facingRaise(combo('Qs Jh'), 90));

    expect(dear, 'the same hand should fold more for 89bb than for 1.5bb').toBeGreaterThan(cheap);
  });

  it('does not fold when checking is free', () => {
    // The one line of play that is never right and is easy to emit by accident:
    // `legalActions` does not even offer fold when there is nothing to call.
    const state = flopHeadsUp('As 9h 2c');

    expect(state.toAct).toBe('BB');
    const recommendation = strategy().recommend(state, 'BB');

    expect(recommendation.frequencies.some((entry) => entry.action === 'fold')).toBe(false);
  });
});

describe('createHeuristicStrategy — across every street', () => {
  /**
   * Checked down street by street. The point is coverage: `chart-strategy`
   * throws on every one of these, and before this phase there was no answer at
   * all past the preflop decision.
   */
  it('decides on the flop, the turn and the river', () => {
    let state = flopHeadsUp('As 9h 2c');
    const runout = parseCards('5d Kh');
    const seen: string[] = [];

    for (let step = 0; step < 12; step++) {
      if (state.toAct !== undefined) {
        const recommendation = strategy().recommend(state, state.toAct);
        expect(frequencySum(recommendation.frequencies)).toBeCloseTo(1, 6);
        seen.push(state.street);
        state = applyAction(state, 'check');
        continue;
      }

      const needed = boardCardsNeeded(state);
      if (needed <= 0) break;
      state = dealBoard(state, runout.slice(state.board.length - 3, state.board.length - 3 + needed));
    }

    expect(new Set(seen), 'every street should have been decided on').toEqual(
      new Set(['flop', 'turn', 'river']),
    );
  });
});
