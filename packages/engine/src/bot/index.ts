/**
 * Playing hands against opponents — the eleventh engine module.
 *
 * docs/03-poker-engine.md said what remains for v2 "is new surface, not gaps in
 * this one", and this is that surface: sampling an action from a strategy,
 * running a hand to completion, and keeping a table of players between hands.
 *
 * The rules live in `game` and the decisions live in `strategy`. This module
 * only drives them, which is why it is small.
 */

export { sampleAction } from './act';

export type { BotProfile } from './profile';
export { BOT_PROFILES, profileById } from './profile';

export type { HandProgress, Step, StepOptions } from './step';
export { actInHand, advanceHand, stepHand } from './step';

export type {
  HeroDecisionPoint,
  PlayHandOptions,
  PlayedHand,
  ReplayHandOptions,
  ReplayedHand,
} from './hand';
export { playHand, replayHand } from './hand';

export type {
  CreateTableOptions,
  OpenTableHand,
  PlayTableHandOptions,
  Table,
  TableHand,
  TablePlayer,
} from './table';
export {
  createTable,
  finishTableHand,
  playTableHand,
  positionsFor,
  startTableHand,
  tableHandConfig,
} from './table';
