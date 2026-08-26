/**
 * Explaining a chart cell with no hand in progress.
 *
 * The Range Explorer (Phase 6) browses charts freely — there is no drill, so
 * there is no `HandState` to hand to `Strategy.recommend`, which is the only
 * route to a `Rationale`.
 *
 * The tempting shortcut is to rebuild the rationale from the chart key: derive
 * `seatsBehind` from the position and `priorRaises` from the action sequence,
 * and assemble the factors again. That is a second implementation of the thing
 * the drill does, and the two would drift. When they drift, the study tool
 * teaches one explanation and the trainer marks against another — which is the
 * single worst failure this feature could have.
 *
 * So instead this replays the spot the chart describes, using the drill's own
 * `rebuildSpot`, and asks the ordinary `ChartStrategy`. Agreement is then
 * structural rather than merely tested.
 *
 * Cost: building a `HandState` per call. The explorer needs this only for the
 * hand a user has actually selected — the 169 cells render from
 * `handStrategy()`, which is a map lookup — so it runs once per click.
 */

import { CANONICAL_HANDS, combosOf, formatCard, type HandNotation } from '../cards';
import { rebuildSpot, type DrillScenario } from '../drills';
import type { ChartRegistry, RangeChart } from '../ranges';
import { lookupChart } from '../ranges';

import { createChartStrategy } from './chart-strategy';
import type { ActionRecommendation } from './strategy';

export interface ExplainChartHandOptions {
  chart: RangeChart;
  hand: HandNotation;
  /** Needed to price the opener's raise for a `vs_*_open` chart. */
  registry: ChartRegistry;
  chartVersion: string;
}

/** `vs_btn_open` -> `BTN`. Undefined for an unopened pot. */
function openerOf(actionSequence: string): string | undefined {
  const match = /^vs_([a-z]+)_open$/.exec(actionSequence);
  return match?.[1]?.toUpperCase();
}

/**
 * The size the opener raised to.
 *
 * Read from the *opener's* RFI chart, not from hero's. A big-blind defence
 * chart's raise entries are 3-bet sizes; using one of those as the open size
 * would replay a spot that never happened.
 */
function openSizeFor(chart: RangeChart, registry: ChartRegistry): number | undefined {
  const opener = openerOf(chart.actionSequence);
  if (opener === undefined) return undefined;

  const openerChart = lookupChart(registry, {
    tableSize: chart.tableSize,
    stackDepth: chart.stackDepth,
    heroPosition: opener as RangeChart['heroPosition'],
    actionSequence: 'rfi',
  });

  if (openerChart === undefined) {
    throw new RangeError(
      `cannot explain ${chart.actionSequence}: no ${opener} rfi chart to read the open size from`,
    );
  }

  const sizes = new Set<number>();
  for (const entries of Object.values(openerChart.ranges)) {
    for (const entry of entries) {
      if (entry.action === 'raise' && entry.size !== undefined) sizes.add(entry.size);
    }
  }

  if (sizes.size !== 1) {
    throw new RangeError(
      `cannot explain ${chart.actionSequence}: ${opener}'s rfi chart opens to ${sizes.size} different sizes`,
    );
  }

  return [...sizes][0];
}

export function explainChartHand(options: ExplainChartHandOptions): ActionRecommendation {
  const { chart, hand, registry, chartVersion } = options;

  if (!CANONICAL_HANDS.includes(hand)) {
    throw new RangeError(`"${hand}" is not one of the 169 canonical hands`);
  }

  // Any combo of the notation replays the same spot: the rationale is built
  // from the hand class, never from the specific cards. The agreement tests
  // are what hold that true.
  const representative = combosOf(hand)[0]!;

  const scenario: DrillScenario = {
    templateSlug: 'range-explorer',
    heroPosition: chart.heroPosition,
    actionSequence: chart.actionSequence,
    hand,
    hole: [formatCard(representative[0]), formatCard(representative[1])],
    tableSize: chart.tableSize,
    stackDepth: chart.stackDepth,
  };

  const openSize = openSizeFor(chart, registry);
  if (openSize !== undefined) scenario.openSize = openSize;

  const spot = rebuildSpot(scenario);

  return createChartStrategy({ registry, chartVersion }).recommend(spot.state, spot.hero);
}
