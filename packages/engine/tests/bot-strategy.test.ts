import { describe, expect, it } from 'vitest';

import type { Combo } from '../src/cards';
import { parseCards } from '../src/cards';
import { applyAction, createHandState, dealBoard } from '../src/game';
import type { Position, Range, RangeChart } from '../src/ranges';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, createChartRegistry } from '../src/ranges';
import { mulberry32 } from '../src/rng';
import { HEURISTIC_VERSION, createBotStrategy } from '../src/strategy';

/**
 * The composite: charts where they exist, heuristics where they do not.
 *
 * The ordering is the whole point and it only runs one way. Where a chart
 * covers the spot, the chart is the answer — it is authored, reviewed content
 * and the heuristic is a guess. The heuristic exists because the seeded content
 * is **ten charts**, and a hand that gets past the first raise has already left
 * them behind.
 *
 * Which is also why the composite asks `chartRecommendation` rather than
 * catching what `createChartStrategy` throws: leaving charted territory is the
 * normal case here, not the exceptional one, and exceptions for control flow
 * would put a try/catch around every decision the bot ever makes.
 */

function combo(text: string): Combo {
  const [a, b] = parseCards(text);
  return [a!, b!];
}

const OPEN: Range = {
  AA: [{ action: 'raise', size: 2.5, freq: 1 }],
  '72o': [{ action: 'fold', freq: 1 }],
};

function chart(heroPosition: Position, actionSequence: string, ranges: Range): RangeChart {
  return {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition,
    actionSequence,
    skillTags: [],
    ranges,
  };
}

const registry = createChartRegistry({
  version: '2026.09.05-1',
  published: true,
  charts: [chart('UTG', 'rfi', OPEN)],
});

const bot = (seed = 1) =>
  createBotStrategy({ registry, chartVersion: '2026.09.05-1', rng: mulberry32(seed), trials: 60 });

describe('createBotStrategy', () => {
  it('uses the chart where one covers the spot', () => {
    const state = createHandState({ hole: { UTG: combo('Ah Ad') } });
    const recommendation = bot().recommend(state, 'UTG');

    expect(recommendation.source).toBe('chart');
    expect(recommendation.chartVersion).toBe('2026.09.05-1');
    expect(recommendation.frequencies).toEqual([{ action: 'raise', size: 2.5, freq: 1 }]);
  });

  it('returns the chart’s answer byte for byte, not an approximation of it', () => {
    // The failure this guards is a composite that "consults" both and blends.
    // A chart is authored content; a heuristic is a guess, and mixing them
    // would make the bot play a strategy nobody wrote.
    const state = createHandState({ hole: { UTG: combo('7h 2c') } });
    const recommendation = bot().recommend(state, 'UTG');

    expect(recommendation.frequencies).toEqual([{ action: 'fold', freq: 1 }]);
    expect(recommendation.source).toBe('chart');
  });

  it('falls back to the heuristic for a seat no chart covers', () => {
    // HJ facing an UTG open. There is no cold-call chart for it and there never
    // was — `deriveActionSequence` returns undefined for every non-BB seat
    // facing a raise.
    let state = createHandState({
      hole: { UTG: combo('Ah Ad'), HJ: combo('Kh Kd') },
    });
    state = applyAction(state, 'raise', 2.5);

    const recommendation = bot().recommend(state, 'HJ');

    expect(recommendation.source).toBe('heuristic');
    expect(recommendation.chartVersion).toBe(HEURISTIC_VERSION);
  });

  it('falls back to the heuristic on every postflop street', () => {
    let state = createHandState({
      hole: { BTN: combo('Ah Kd'), BB: combo('7c 2d') },
    });
    for (let i = 0; i < 3; i++) state = applyAction(state, 'fold');
    state = applyAction(state, 'raise', 2.5);
    state = applyAction(state, 'fold'); // SB
    state = applyAction(state, 'call'); // BB
    state = dealBoard(state, parseCards('As 9h 2c'));

    const recommendation = bot().recommend(state, state.toAct!);

    expect(state.street).toBe('flop');
    expect(recommendation.source).toBe('heuristic');
  });

  it('falls back when the sequence is derivable but nobody authored the chart', () => {
    // CO's RFI is a real key. This registry only holds UTG's, so the lookup
    // misses — a different failure from "no family covers this" and one the
    // composite must also survive.
    const state = createHandState({ hole: { CO: combo('Ah Ad') } });
    let advanced = state;
    advanced = applyAction(advanced, 'fold'); // UTG
    advanced = applyAction(advanced, 'fold'); // HJ

    const recommendation = bot().recommend(advanced, 'CO');

    expect(recommendation.source).toBe('heuristic');
  });

  it('is deterministic for a seed', () => {
    let state = createHandState({
      hole: { UTG: combo('Ah Ad'), HJ: combo('Kh Kd') },
    });
    state = applyAction(state, 'raise', 2.5);

    expect(bot(9).recommend(state, 'HJ').frequencies).toEqual(
      bot(9).recommend(state, 'HJ').frequencies,
    );
  });
});
