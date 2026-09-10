/**
 * The join between a hand in progress and Phase 2's charts.
 *
 * Turning "who has done what" into a `ChartKey` is the whole job: everything
 * else is a lookup that Phase 2 already tested. When the spot is one no seeded
 * chart family covers, this throws naming the key it looked for, rather than
 * answering from a neighbouring chart — a confidently wrong recommendation is
 * far worse for a teaching tool than a missing one.
 */

import { comboCountOf, handNotationOf } from '../cards';
import type { HandState } from '../game';
import { actionOrder, seatAt } from '../game';
import type { ChartKey, ChartRegistry, Position, Range, RangeChart } from '../ranges';
import {
  STACK_DEPTH_100BB,
  TABLE_SIZE_6MAX,
  chartKeyId,
  comboCount,
  handStrategy,
  lookupChart,
  primaryAction,
  toWeights,
} from '../ranges';

import { factor, rationale } from './rationale';
import type { ActionRecommendation, Strategy } from './strategy';

/**
 * The largest open, in big blinds, that the seeded blind-defence charts model.
 * Phase 2 authored them against a 2.5bb open (3bb from the small blind), so a
 * 20bb open or an all-in is a different spot entirely.
 *
 * The chart format does not yet record the open size it assumes. When it does,
 * this constant should be replaced by that field rather than widened here.
 */
export const MAX_OPEN_BLINDS = 4;

/**
 * How far the effective stack may sit from `stackDepth` and still be the spot
 * the charts describe.
 *
 * `state.stackDepth` is what the table *says* it is, and until 12c that was the
 * only thing checked. 12b's table topped losers up and never took a chip off a
 * winner, so a sitting climbed to an average stack of 1,700bb with `stackDepth`
 * still reading 100 — and every hand of it was graded against 100bb charts. A
 * 17x-deep pot is a different game: it changes which hands are worth playing,
 * how much a raise threatens, and what a call is worth, and no seeded chart has
 * anything to say about it.
 *
 * The band is generous on purpose. It is a coverage check, not a strategy: a
 * few big blinds either side of 100 is the same spot to anybody, and a hand
 * played 12bb deep or 900bb deep is not.
 */
export const CHART_STACK_BAND = { min: 0.6, max: 1.5 } as const;

/**
 * The effective stack **at the deal**, in big blinds.
 *
 * Starting stacks, not current ones — a seat's chips move the moment the blinds
 * are posted, and reading `seat.stack` would make every blind-defence spot look
 * short and drop half the seeded content on the floor.
 *
 * Effective rather than absolute, because nobody can win more than the shorter
 * stack: one 900bb seat at an otherwise 100bb table is still playing a 100bb
 * pot against everybody else.
 */
function isChartedDepth(state: HandState, hero: Position): boolean {
  const effective = effectiveStack(state, hero) / state.bigBlind;

  return (
    effective >= CHART_STACK_BAND.min * state.stackDepth &&
    effective <= CHART_STACK_BAND.max * state.stackDepth
  );
}

function effectiveStack(state: HandState, hero: Position): number {
  const startingStack = (position: Position): number => {
    const seat = seatAt(state, position);
    return seat.stack + seat.totalCommitted;
  };

  const opponents = state.seats
    .filter((seat) => seat.position !== hero && seat.status !== 'folded')
    .map((seat) => startingStack(seat.position));

  if (opponents.length === 0) return startingStack(hero);

  return Math.min(startingStack(hero), Math.max(...opponents));
}

export interface ChartStrategyOptions {
  registry: ChartRegistry;
  /** Recorded on every recommendation, and from there onto every attempt. */
  chartVersion: string;
}

/**
 * Which chart family, if any, covers this spot.
 *
 * Phase 2 seeded two: opening first-in, and big blind defence against a single
 * open. Anything else — a limped pot, a three-bet, a non-blind seat facing an
 * open, any postflop street — returns undefined, because inventing a key that
 * happens to resolve would silently grade against the wrong chart.
 */
export function deriveActionSequence(state: HandState, hero: Position): string | undefined {
  if (state.street !== 'preflop') return undefined;

  // Only answer the question actually being asked. Without this, a seat that
  // has already folded — or one that has not reached its turn — gets a
  // confident recommendation for a decision it is not making.
  if (state.toAct !== hero) return undefined;

  const before = state.history.filter((entry) => entry.street === 'preflop');
  const raises = before.filter((entry) => entry.action === 'raise' || entry.action === 'allin');
  const calls = before.filter((entry) => entry.action === 'call');

  if (calls.length > 0) return undefined;

  if (raises.length === 0) {
    // First in: nobody has put money in voluntarily.
    return 'rfi';
  }

  if (raises.length === 1 && hero === 'BB') {
    const open = raises[0]!;
    const size = open.size ?? 0;

    // The size gate is load-bearing. The blind-defence charts are authored
    // against a standard open; against a 100bb jam they would tell the big
    // blind to "raise to 11", which is not a legal action in that state, and
    // to stack off 100bb with 22 off a chart that means "call 1.5 into 4".
    if (size <= state.bigBlind || size > MAX_OPEN_BLINDS * state.bigBlind) return undefined;

    return `vs_${open.position.toLowerCase()}_open`;
  }

  return undefined;
}

function buildRationale(
  state: HandState,
  hero: Position,
  hand: string,
  sequence: string,
  chart: RangeChart,
  frequencies: readonly { action: string; freq: number }[],
) {
  const width = comboCount(toWeights(chart.ranges as Range));

  // Seats still to act *after* hero on this street. The earlier version counted
  // all active seats minus one, which reported 1 for every blind-defence spot,
  // where the big blind has nobody behind it.
  const order = actionOrder(state.street);
  const seatsBehind = order
    .slice(order.indexOf(hero) + 1)
    .filter((position) =>
      state.seats.some((seat) => seat.position === position && seat.status === 'active'),
    ).length;

  // Actual raises, not history length: three folds are not three prior raises.
  const priorRaises = state.history.filter(
    (entry) =>
      entry.street === state.street && (entry.action === 'raise' || entry.action === 'allin'),
  ).length;

  const factors = [
    factor('position', 'high', { position: hero, seatsBehind }),
    factor('hand_class', 'high', { hand, combos: comboCountOf(hand) }),
    factor('action_sequence', 'medium', { sequence, priorRaises }),
    factor('range_shape', 'medium', {
      combos: Math.round(width * 10) / 10,
      rangePercent: Math.round((width / 1326) * 1000) / 10,
    }),
  ];

  if (frequencies.length > 1) {
    factors.push(
      factor('mix', 'high', {
        actions: frequencies.length,
        topFrequency: Math.round(Math.max(...frequencies.map((f) => f.freq)) * 100) / 100,
      }),
    );
  }

  return rationale(factors);
}

/**
 * The chart's answer for this spot, or `undefined` when no chart covers it.
 *
 * Split out of `recommend` in Phase 12a so the bot's composite strategy can ask
 * "is this a charted spot?" **without using exceptions for control flow.** The
 * bot leaves charted territory on almost every hand — the seeded content is ten
 * spots, and a hand that gets past the first raise is already outside it — so a
 * try/catch around every decision would be the normal path rather than the
 * exceptional one.
 *
 * The two throws below are misuse rather than absence, and stay throws:
 * recommending for a seat that is not acting, or for one holding no cards, is a
 * caller bug at any level of coverage.
 */
export function chartRecommendation(
  state: HandState,
  hero: Position,
  options: ChartStrategyOptions,
): ActionRecommendation | undefined {
  const { registry, chartVersion } = options;

  // Coverage, not misuse: v1 authored 6-max 100bb and nothing else.
  if (state.tableSize !== TABLE_SIZE_6MAX || state.stackDepth !== STACK_DEPTH_100BB) {
    return undefined;
  }

  if (state.toAct !== hero) {
    throw new RangeError(
      `it is ${state.toAct ?? 'nobody'}'s turn, not ${hero}'s — nothing to recommend`,
    );
  }

  // And the chips, not only the label the table wears. See CHART_STACK_BAND.
  if (!isChartedDepth(state, hero)) return undefined;

  const seat = seatAt(state, hero);
  if (seat.hole === undefined) {
    throw new RangeError(`${hero} has no cards, so there is nothing to recommend`);
  }

  const sequence = deriveActionSequence(state, hero);
  if (sequence === undefined) return undefined;

  const chart = lookupChart(registry, chartKeyFor(hero, sequence));
  if (chart === undefined) return undefined;

  const hand = handNotationOf(seat.hole[0], seat.hole[1]);
  const frequencies = handStrategy(chart.ranges, hand);
  const best = primaryAction(frequencies);

  return {
    frequencies,
    primary: best.action,
    ...(best.size !== undefined ? { primarySize: best.size } : {}),
    rationale: buildRationale(state, hero, hand, sequence, chart, frequencies),
    source: 'chart',
    chartVersion,
  };
}

function chartKeyFor(hero: Position, actionSequence: string): ChartKey {
  return {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition: hero,
    actionSequence,
  };
}

/**
 * The throwing form, and the only one the drill path uses.
 *
 * Unchanged in behaviour: when no chart family covers the spot this still
 * throws naming the key it looked for, because "a confidently wrong
 * recommendation is far worse for a teaching tool than a missing one". The
 * reason is re-derived here rather than carried out of `chartRecommendation`,
 * so each failure keeps the specific message it always had.
 */
export function createChartStrategy(options: ChartStrategyOptions): Strategy {
  return {
    recommend(state: HandState, hero: Position): ActionRecommendation {
      const recommendation = chartRecommendation(state, hero, options);
      if (recommendation !== undefined) return recommendation;

      if (state.tableSize !== TABLE_SIZE_6MAX || state.stackDepth !== STACK_DEPTH_100BB) {
        throw new RangeError(
          `v1 charts cover 6-max 100bb only, got ${state.tableSize}-max ${state.stackDepth}bb`,
        );
      }

      if (!isChartedDepth(state, hero)) {
        const effective = Math.round(effectiveStack(state, hero) / state.bigBlind);
        throw new RangeError(
          `v1 charts cover ${state.stackDepth}bb; ${hero} has an effective stack of ${effective}bb`,
        );
      }

      const sequence = deriveActionSequence(state, hero);
      if (sequence === undefined) {
        throw new RangeError(
          `no chart family covers this spot for ${hero} on the ${state.street}`,
        );
      }

      // The sequence is derivable and the spot is 6-max 100bb, so the only
      // thing left is a key nobody authored a chart for.
      throw new RangeError(`no chart for ${chartKeyId(chartKeyFor(hero, sequence))}`);
    },
  };
}
