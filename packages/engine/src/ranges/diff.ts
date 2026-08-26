/**
 * Comparing two ranges.
 *
 * docs/05-ui-ux.md makes side-by-side compare the desktop feature "serious
 * students will tell other people about" — "how does my BTN opening range
 * change vs. a 3-bettor?". Its value rests entirely on the highlighting being
 * true, so the comparison is defined here as data rather than assembled ad hoc
 * in a component. CLAUDE.md: never put poker logic in a React component.
 *
 * The scalar is **total variation distance**, ½·Σ|Δfreq| over the union of the
 * two distributions' entries. It is 0 for identical mixes and 1 for disjoint
 * ones, symmetric, and bounded — which is what lets a UI map it straight onto
 * highlight intensity without inventing its own scale.
 *
 * The alternative — counting how many actions changed — would rank a hand that
 * moved 1% across three actions as a bigger change than one that flipped from
 * a pure raise to a pure fold.
 */

import { CANONICAL_HANDS, type HandNotation } from '../cards';

import type { Action } from './action';
import type { ChartKey, RangeChart } from './chart';
import { chartKeyOf } from './chart';
import { FREQ_TOLERANCE, type ActionFreq, handStrategy, primaryAction } from './range';

export interface ActionDelta {
  action: Action;
  /** Present when the action carries one; a size change is a real change. */
  size?: number;
  /** Signed, from `a` towards `b`. Negative means `b` does it less. */
  delta: number;
}

export interface HandDiff {
  hand: HandNotation;
  /** Total variation distance in [0, 1]. 0 identical, 1 disjoint. */
  distance: number;
  /** Whether the highest-frequency action differs. */
  primaryChanged: boolean;
  /** Only entries that actually moved, largest movement first. */
  deltas: readonly ActionDelta[];
}

export interface ChartDiff {
  a: ChartKey;
  b: ChartKey;
  /** All 169, in `CANONICAL_HANDS` order, so a grid can index it positionally. */
  hands: readonly HandDiff[];
  changedCount: number;
}

/**
 * Distributions are keyed by action *and* size.
 *
 * Collapsing on action alone would report "raise 100% vs raise 100%" — no
 * change — across a chart that moved from raising 2.5bb to raising 3bb. That is
 * a genuine strategic difference and one of the things a student would open
 * compare mode to find.
 */
function entryKey(entry: ActionFreq): string {
  return entry.size === undefined ? entry.action : `${entry.action}|${entry.size}`;
}

export function diffHandStrategy(
  a: readonly ActionFreq[],
  b: readonly ActionFreq[],
): Omit<HandDiff, 'hand'> {
  const left = new Map<string, ActionFreq>();
  const right = new Map<string, ActionFreq>();

  for (const entry of a) left.set(entryKey(entry), entry);
  for (const entry of b) right.set(entryKey(entry), entry);

  const deltas: ActionDelta[] = [];
  let absolute = 0;

  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const from = left.get(key);
    const to = right.get(key);
    const delta = (to?.freq ?? 0) - (from?.freq ?? 0);

    absolute += Math.abs(delta);

    // Float noise is not a strategic difference. Same tolerance the validator
    // uses to accept a distribution as summing to 1.
    if (Math.abs(delta) <= FREQ_TOLERANCE) continue;

    const source = from ?? to;
    /* c8 ignore next -- the key came from one of the two maps, so one exists */
    if (source === undefined) continue;

    const entry: ActionDelta = { action: source.action, delta };
    if (source.size !== undefined) entry.size = source.size;
    deltas.push(entry);
  }

  deltas.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const primaryA = primaryAction(a);
  const primaryB = primaryAction(b);

  return {
    distance: absolute / 2,
    primaryChanged:
      primaryA.action !== primaryB.action || primaryA.size !== primaryB.size,
    deltas,
  };
}

export function diffCharts(a: RangeChart, b: RangeChart): ChartDiff {
  const hands: HandDiff[] = [];
  let changedCount = 0;

  for (const hand of CANONICAL_HANDS) {
    // handStrategy applies the absent-means-fold convention, so a hand charted
    // in one and omitted from the other reads as raise-vs-fold rather than as
    // missing data to be skipped.
    const diff = diffHandStrategy(handStrategy(a.ranges, hand), handStrategy(b.ranges, hand));

    if (diff.distance > 0) changedCount += 1;
    hands.push({ hand, ...diff });
  }

  return { a: chartKeyOf(a), b: chartKeyOf(b), hands, changedCount };
}

/** Positional lookup into a diff, for callers that have a hand and not an index. */
export function handDiffOf(diff: ChartDiff, hand: HandNotation): HandDiff {
  const index = CANONICAL_HANDS.indexOf(hand);
  if (index < 0) {
    throw new RangeError(`"${hand}" is not one of the 169 canonical hands`);
  }
  return diff.hands[index]!;
}
