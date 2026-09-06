import { describe, expect, it } from 'vitest';

import { parseCard } from '../src/cards';
import { reviewHandDecisions } from '../src/drills';
import { applyAction, createHandState } from '../src/game';
import type { HandState } from '../src/game';
import { createChartRegistry } from '../src/ranges';
import type { Position, Range, RangeChart } from '../src/ranges';

/**
 * Grading hero's own decisions inside a hand they played.
 *
 * The rule this file encodes is narrower than "preflop is graded", and the
 * narrowness is the honest part. The seeded content is ten charts — RFI for
 * five seats and big-blind defence against five single openers — so hero is in
 * charted territory only when first in, or defending the blind against exactly
 * one open. Everything else is **reported and labelled**, never scored.
 *
 * Why that matters enough to test rather than assume: the alternative is
 * grading against `createHeuristicStrategy`, which 12a built for the bot on the
 * explicit promise that it would never mark a human. An uncharted spot that
 * quietly acquired a tier would be that promise broken, and it would look
 * exactly like a charted one.
 *
 * Note the module. This lives in `drills/`, which
 * `tests/grading-isolation.test.ts` forbids from importing `bot/` at all — so
 * it takes decision points as plain data and never learns that an opponent
 * exists.
 */

const OPEN: Range = {
  AA: [{ action: 'raise', size: 2.5, freq: 1 }],
  AKs: [
    { action: 'raise', size: 2.5, freq: 0.7 },
    { action: 'fold', freq: 0.3 },
  ],
  '72o': [{ action: 'fold', freq: 1 }],
};

const chart = (heroPosition: Position): RangeChart => ({
  tableSize: 6,
  stackDepth: 100,
  heroPosition,
  actionSequence: 'rfi',
  skillTags: [],
  ranges: OPEN,
});

/** UTG alone, so an HJ open is a real spot with no chart behind it. */
const registry = createChartRegistry({
  version: 'test-1',
  published: true,
  charts: [chart('UTG')],
});

const options = { registry, chartVersion: 'test-1' };

const combo = (a: string, b: string) => [parseCard(a), parseCard(b)] as const;

function dealt(hole: Partial<Record<Position, readonly [number, number]>>): HandState {
  return createHandState({
    tableSize: 6,
    hole: hole as never,
  });
}

describe('reviewHandDecisions', () => {
  it('grades a preflop spot a chart covers', () => {
    const state = dealt({ UTG: combo('As', 'Ah') as never });

    const [decision] = reviewHandDecisions(
      [{ state, action: { street: 'preflop', position: 'UTG', action: 'raise', size: 2.5 } }],
      options,
    );

    expect(decision!.grade?.tier).toBe('optimal');
    expect(decision!.uncharted).toBeUndefined();
    // The mix comes back, because the mix is the lesson.
    expect(decision!.frequencies).toEqual(OPEN.AA);
    expect(decision!.rationale?.factors.length).toBeGreaterThan(0);
  });

  it('grades a defensible action in a mixed spot as acceptable, not wrong', () => {
    const state = dealt({ UTG: combo('As', 'Ks') as never });

    const [decision] = reviewHandDecisions(
      [{ state, action: { street: 'preflop', position: 'UTG', action: 'fold' } }],
      options,
    );

    // AKs folds 30% of the time here. Folding it is a real part of the strategy.
    expect(decision!.grade?.tier).toBe('acceptable');
  });

  it('reports a preflop spot no chart covers, without a grade', () => {
    // UTG folds, so the hijack is now first in — a real `rfi` spot, and there
    // is no hijack chart.
    let state = dealt({ UTG: combo('7d', '2c') as never, HJ: combo('As', 'Ah') as never });
    state = applyAction(state, 'fold');

    const [decision] = reviewHandDecisions(
      [{ state, action: { street: 'preflop', position: 'HJ', action: 'raise', size: 2.5 } }],
      options,
    );

    expect(decision!.grade).toBeUndefined();
    expect(decision!.uncharted).toBe('no-chart');
    expect(decision!.frequencies).toBeUndefined();
  });

  it('reports every postflop decision as postflop, whatever the charts hold', () => {
    let state = dealt({ UTG: combo('As', 'Ah') as never, BB: combo('7d', '2c') as never });
    state = applyAction(state, 'raise', 2.5); // UTG
    for (let i = 0; i < 4; i++) state = applyAction(state, 'fold'); // HJ CO BTN SB
    state = applyAction(state, 'call'); // BB
    expect(state.street).toBe('flop');

    const [decision] = reviewHandDecisions(
      [{ state, action: { street: 'flop', position: 'BB', action: 'check' } }],
      options,
    );

    expect(decision!.grade).toBeUndefined();
    expect(decision!.uncharted).toBe('postflop');
  });

  it('never carries both a grade and a reason it could not grade', () => {
    let opened = dealt({ UTG: combo('As', 'Ah') as never, HJ: combo('Ad', 'Kd') as never });
    const first = { state: opened, action: { street: 'preflop' as const, position: 'UTG' as const, action: 'raise' as const, size: 2.5 } };
    opened = applyAction(opened, 'raise', 2.5);

    const decisions = reviewHandDecisions(
      [
        first,
        { state: opened, action: { street: 'preflop', position: 'HJ', action: 'fold' } },
      ],
      options,
    );

    expect(decisions).toHaveLength(2);
    for (const decision of decisions) {
      expect(
        (decision.grade === undefined) !== (decision.uncharted === undefined),
        'exactly one of grade and uncharted must be present',
      ).toBe(true);
    }
  });

  it('keeps the decisions in the order they were taken', () => {
    const state = dealt({ UTG: combo('As', 'Ah') as never });

    const decisions = reviewHandDecisions(
      [
        { state, action: { street: 'preflop', position: 'UTG', action: 'raise', size: 2.5 } },
        { state, action: { street: 'preflop', position: 'UTG', action: 'fold' } },
      ],
      options,
    );

    expect(decisions.map((decision) => decision.action.action)).toEqual(['raise', 'fold']);
    expect(decisions.map((decision) => decision.street)).toEqual(['preflop', 'preflop']);
  });

  it('has nothing to say about a hand with no decisions in it', () => {
    expect(reviewHandDecisions([], options)).toEqual([]);
  });
});
