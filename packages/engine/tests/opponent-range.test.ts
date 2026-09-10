import { describe, expect, it } from 'vitest';

import { CANONICAL_HANDS, parseCards } from '../src/cards';
import type { Combo } from '../src/cards';
import { applyAction, createHandState, dealBoard } from '../src/game';
import type { Position, Range, RangeChart } from '../src/ranges';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, createChartRegistry, toWeights } from '../src/ranges';
import { continuingRange, narrowestOpponent } from '../src/strategy';

/**
 * The opponent model, and why it is the chart set.
 *
 * Until 12c the bot measured its equity against **one uniformly random hand**.
 * "I beat a random hand" was then compared straight to the price the pot was
 * offering, so a bot read "I beat the range that just raised me" off a number
 * that knew nothing about the raise. Measured over 400 hands: facing a bet
 * postflop the bots raised 41% of the time and folded 14%, and somebody was
 * all-in in 38% of hands.
 *
 * The fix does not invent ranges. CLAUDE.md keeps strategy content in
 * `packages/content` — "never hardcoded in components or engine logic" — and a
 * table of "what a cutoff opener holds" written here would be exactly that. So
 * the model is the registry that is already injected into every bot strategy:
 * a seat that opened holds that seat's RFI chart, a big blind that defended
 * holds the defence chart, and **everything else is uniform**.
 *
 * Uniform is not a shrug in those cases, it is the honest answer twice over: a
 * big blind that checked its option really does hold any two cards, and for the
 * cold-call and 3-bet spots nobody has authored, saying "unknown" is the same
 * refusal `hand-review.ts` makes when it reports `uncharted` rather than
 * grading against a guess.
 */

function combo(text: string): Combo {
  const [a, b] = parseCards(text);
  return [a!, b!];
}

const RFI: Range = {
  AA: [{ action: 'raise', size: 2.5, freq: 1 }],
  KK: [{ action: 'raise', size: 2.5, freq: 1 }],
  AKs: [
    { action: 'raise', size: 2.5, freq: 0.5 },
    { action: 'fold', freq: 0.5 },
  ],
  '72o': [{ action: 'fold', freq: 1 }],
};

const DEFENCE: Range = {
  AA: [{ action: 'raise', size: 11, freq: 1 }],
  KK: [
    { action: 'raise', size: 11, freq: 0.4 },
    { action: 'call', freq: 0.6 },
  ],
  QQ: [{ action: 'call', freq: 1 }],
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
  charts: [
    chart('UTG', 'rfi', RFI),
    chart('BTN', 'rfi', RFI),
    chart('BB', 'vs_utg_open', DEFENCE),
  ],
});

/** Every one of the 169, weight 1. What "I know nothing" looks like. */
const UNIFORM = Object.fromEntries(CANONICAL_HANDS.map((hand) => [hand, 1]));

const hole = { UTG: combo('Ah Ad'), HJ: combo('Kh Kd'), BB: combo('Qh Qd') };

/** UTG opens to 2.5 and everyone in between folds. */
function utgOpens() {
  return applyAction(createHandState({ hole }), 'raise', 2.5);
}

describe('continuingRange', () => {
  it('gives an opener the chart they opened from', () => {
    const state = utgOpens();

    expect(continuingRange(state, 'UTG', registry)).toEqual(toWeights(RFI, 'raise'));
  });

  it('carries a mixed hand at the frequency it is opened', () => {
    // AKs opens half the time. A model that rounded it to "in the range" would
    // say the opener holds it as often as aces, which is the error this whole
    // module exists to stop making in the other direction.
    const weights = continuingRange(utgOpens(), 'UTG', registry);

    expect(weights.AKs).toBeCloseTo(0.5, 10);
    expect(weights.AA).toBe(1);
    expect(weights['72o']).toBe(0);
  });

  it('gives a big blind that called the calling half of its defence chart', () => {
    let state = utgOpens();
    for (let i = 0; i < 4; i++) state = applyAction(state, 'fold'); // HJ, CO, BTN, SB
    state = applyAction(state, 'call'); // BB

    const weights = continuingRange(state, 'BB', registry);

    expect(weights).toEqual(toWeights(DEFENCE, 'call'));
    // Aces are pure raise in this chart, so a caller never holds them.
    expect(weights.AA).toBe(0);
    expect(weights.KK).toBeCloseTo(0.6, 10);
  });

  it('gives a big blind that three-bet the raising half instead', () => {
    let state = utgOpens();
    for (let i = 0; i < 4; i++) state = applyAction(state, 'fold');
    state = applyAction(state, 'raise', 11); // BB

    const weights = continuingRange(state, 'BB', registry);

    expect(weights.AA).toBe(1);
    expect(weights.KK).toBeCloseTo(0.4, 10);
    expect(weights.QQ).toBe(0);
  });

  it('says nothing about a seat that cold-called an open', () => {
    // There is no cold-call chart and there never was. Inventing one here would
    // put strategy content in the engine.
    let state = utgOpens();
    state = applyAction(state, 'call'); // HJ

    expect(continuingRange(state, 'HJ', registry)).toEqual(UNIFORM);
  });

  it('says nothing about a big blind that checked its option', () => {
    // Everyone folds round to the blinds; the big blind is never asked to act
    // voluntarily. It really is any two cards.
    let state = createHandState({ hole });
    for (let i = 0; i < 4; i++) state = applyAction(state, 'fold'); // UTG..SB
    state = applyAction(state, 'call'); // SB completes
    state = applyAction(state, 'check'); // BB

    expect(continuingRange(state, 'BB', registry)).toEqual(UNIFORM);
  });

  it('says nothing about a non-standard open', () => {
    // The same size gate `deriveActionSequence` applies to the defence charts.
    // A 20bb open is a different spot, and the RFI chart does not describe the
    // hands somebody makes it with.
    const state = applyAction(createHandState({ hole }), 'raise', 20);

    expect(continuingRange(state, 'UTG', registry)).toEqual(UNIFORM);
  });

  it('says nothing when the registry has no chart for the seat', () => {
    const thin = createChartRegistry({
      version: '2026.09.05-1',
      published: true,
      charts: [chart('BTN', 'rfi', RFI)],
    });

    expect(continuingRange(utgOpens(), 'UTG', thin)).toEqual(UNIFORM);
  });

  it('is the range the villain arrived with, on every later street', () => {
    // The preflop range carries forward unchanged. Narrowing it street by
    // street would need numbers nobody has authored; leaving it is the honest
    // approximation and still enormously better than uniform.
    let state = utgOpens();
    for (let i = 0; i < 4; i++) state = applyAction(state, 'fold');
    state = applyAction(state, 'call'); // BB defends
    state = dealBoard(state, parseCards('2h 7c 9d'));

    expect(continuingRange(state, 'UTG', registry)).toEqual(toWeights(RFI, 'raise'));
    expect(continuingRange(state, 'BB', registry)).toEqual(toWeights(DEFENCE, 'call'));
  });

  it('says nothing about a seat that has not acted at all', () => {
    expect(continuingRange(createHandState({ hole }), 'BTN', registry)).toEqual(UNIFORM);
  });
});

describe('narrowestOpponent', () => {
  it('picks the seat whose range is tightest, not the last one to act', () => {
    // UTG opened off a chart; the big blind defended off a wider one. The
    // dangerous opponent is the one holding the narrower range, and that is the
    // one a single-opponent equity number should be measured against.
    let state = utgOpens();
    for (let i = 0; i < 4; i++) state = applyAction(state, 'fold');
    state = applyAction(state, 'call'); // BB
    state = dealBoard(state, parseCards('2h 7c 9d'));

    expect(narrowestOpponent(state, 'BB', registry)).toBe('UTG');
  });

  it('returns undefined when hero has nobody left to beat', () => {
    let state = utgOpens();
    for (let i = 0; i < 5; i++) state = applyAction(state, 'fold'); // everyone else

    expect(narrowestOpponent(state, 'UTG', registry)).toBeUndefined();
  });

  it('falls back to a contesting seat even when every range is uniform', () => {
    let state = createHandState({ hole });
    for (let i = 0; i < 4; i++) state = applyAction(state, 'fold');
    state = applyAction(state, 'call'); // SB completes
    state = applyAction(state, 'check'); // BB

    expect(narrowestOpponent(state, 'BB', registry)).toBe('SB');
  });
});
