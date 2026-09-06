import { describe, expect, it } from 'vitest';

import { applyAction, createHandState, legalActions, potBetSizes, potSize } from '../src/game';

/**
 * The sizes a bet control offers.
 *
 * A drill gets its sizes from `raiseSizeOptions`, which draws from the chart
 * *family* so that hero's own chart cannot hand over the answer. Bot play has
 * no answer to hand over and no chart behind most of its spots, so the sizes
 * come from the pot instead — which is also how every poker client in the world
 * offers them, and what a person is learning to think in.
 *
 * It lives here rather than in the component because it is poker (CLAUDE.md:
 * never put poker logic in a React component), and because "a pot-sized raise
 * is call plus the pot *after* the call" is exactly the arithmetic people get
 * wrong by eye.
 */

describe('potBetSizes', () => {
  it('offers fractions of the pot when nobody has bet', () => {
    let state = createHandState({ tableSize: 6 });
    for (let i = 0; i < 4; i++) state = applyAction(state, 'fold'); // UTG..BTN
    state = applyAction(state, 'call'); // SB
    state = applyAction(state, 'check'); // BB
    expect(state.street).toBe('flop');

    const pot = potSize(state);
    expect(pot).toBe(2);

    const sizes = potBetSizes(state);

    // Half pot and pot are both here; a pot-sized bet into 2bb is 2bb.
    expect(sizes).toContain(1);
    expect(sizes).toContain(2);
    // Ascending, and no duplicates.
    expect([...sizes]).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it('prices a raise as the call plus a share of the pot after it', () => {
    let state = createHandState({ tableSize: 6 });
    state = applyAction(state, 'raise', 3); // UTG opens to 3

    // Pot is 3 + 0.5 + 1 = 4.5, and the hijack has 3 to call.
    expect(potSize(state)).toBe(4.5);

    const sizes = potBetSizes(state);

    // A pot-sized raise: 3 (the current bet) + 1.0 × (4.5 + 3) = 10.5.
    expect(sizes).toContain(10.5);
    // A half-pot raise: 3 + 0.5 × 7.5 = 6.75.
    expect(sizes).toContain(6.75);
  });

  it('never offers a size the rules would reject', () => {
    // A short stack: everything above its all-in has to be dropped, not clamped
    // into a duplicate of it.
    let state = createHandState({ tableSize: 6, stacks: { HJ: 6 } });
    state = applyAction(state, 'raise', 3); // UTG opens; HJ is to act with 6

    const raise = legalActions(state).find((option) => option.action === 'raise');
    const sizes = potBetSizes(state);

    for (const size of sizes) {
      expect(size, `${size} is below the minimum raise`).toBeGreaterThanOrEqual(raise!.minTo!);
      expect(size, `${size} is above what the stack can reach`).toBeLessThanOrEqual(raise!.maxTo!);
    }
  });

  it('offers nothing when there is no aggressive action available', () => {
    // The hand is over.
    let state = createHandState({ tableSize: 6 });
    for (let i = 0; i < 5; i++) state = applyAction(state, 'fold');

    expect(state.toAct).toBeUndefined();
    expect(potBetSizes(state)).toEqual([]);
  });

  it('leaves the all-in to the all-in button', () => {
    // A stack that can only reach its maximum should not have that maximum
    // offered twice, once as "raise to 6" and once as "All in".
    let state = createHandState({ tableSize: 6, stacks: { HJ: 6 } });
    state = applyAction(state, 'raise', 3);

    const raise = legalActions(state).find((option) => option.action === 'raise');
    expect(potBetSizes(state)).not.toContain(raise!.maxTo);
  });
});
