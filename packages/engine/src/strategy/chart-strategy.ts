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

export function createChartStrategy(options: ChartStrategyOptions): Strategy {
  const { registry, chartVersion } = options;

  return {
    recommend(state: HandState, hero: Position): ActionRecommendation {
      if (state.tableSize !== TABLE_SIZE_6MAX || state.stackDepth !== STACK_DEPTH_100BB) {
        throw new RangeError(
          `v1 charts cover 6-max 100bb only, got ${state.tableSize}-max ${state.stackDepth}bb`,
        );
      }

      if (state.toAct !== hero) {
        throw new RangeError(
          `it is ${state.toAct ?? 'nobody'}'s turn, not ${hero}'s — nothing to recommend`,
        );
      }

      const seat = seatAt(state, hero);
      if (seat.hole === undefined) {
        throw new RangeError(`${hero} has no cards, so there is nothing to recommend`);
      }

      const sequence = deriveActionSequence(state, hero);
      if (sequence === undefined) {
        throw new RangeError(
          `no chart family covers this spot for ${hero} on the ${state.street}`,
        );
      }

      const key: ChartKey = {
        tableSize: TABLE_SIZE_6MAX,
        stackDepth: STACK_DEPTH_100BB,
        heroPosition: hero,
        actionSequence: sequence,
      };

      const chart = lookupChart(registry, key);
      if (chart === undefined) {
        throw new RangeError(`no chart for ${chartKeyId(key)}`);
      }

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
    },
  };
}
