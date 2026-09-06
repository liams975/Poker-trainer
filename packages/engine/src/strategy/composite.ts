/**
 * Charts where they exist, heuristics where they do not.
 *
 * The ordering runs one way and only one way: a chart is authored, reviewed
 * content and the heuristic is a guess, so wherever both could answer the chart
 * wins outright. It is not consulted, weighted or blended — a blend would make
 * the bot play a strategy nobody wrote and could not be traced back to either
 * source.
 *
 * The fallback is not an edge case. The seeded content is **ten charts** — RFI
 * for five seats and big-blind defence against five openers — so a hand that
 * gets past the first raise has already left charted territory, and every
 * postflop decision is outside it by construction.
 *
 * Which is why this asks `chartRecommendation` instead of catching what
 * `createChartStrategy` throws. Leaving the charts behind is the normal path
 * here, and exceptions for control flow would mean a try/catch around every
 * decision the bot makes for the whole of a session.
 */

import type { HandState } from '../game';
import type { Position } from '../ranges';

import type { ChartStrategyOptions } from './chart-strategy';
import { chartRecommendation } from './chart-strategy';
import type { HeuristicOptions } from './heuristic-strategy';
import { createHeuristicStrategy } from './heuristic-strategy';
import type { ActionRecommendation, Strategy } from './strategy';

export type BotStrategyOptions = ChartStrategyOptions & HeuristicOptions;

export function createBotStrategy(options: BotStrategyOptions): Strategy {
  const heuristic = createHeuristicStrategy(options);

  return {
    recommend(state: HandState, hero: Position): ActionRecommendation {
      return chartRecommendation(state, hero, options) ?? heuristic.recommend(state, hero);
    },
  };
}
