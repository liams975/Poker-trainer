// Explicit rather than `export *`: `Position` and `POSITIONS` belong to
// ranges/chart.ts and are only imported here. Re-exporting them would collide
// with the root barrel's own `export * from './ranges'`. Internals like
// `streetBetting` and `chips` stay unexported for the same reason — they are
// implementation detail shared between these two files.
export type {
  BettingAction,
  HandConfig,
  HandState,
  Seat,
  SeatStatus,
  Street,
} from './hand-state';
export {
  STREETS,
  actionOrder,
  activeSeats,
  amountToCall,
  contestingSeats,
  createHandState,
  currentBet,
  dealBoard,
  hasActedSinceLastAggression,
  minRaiseTo,
  potSize,
  seatAt,
} from './hand-state';

export type { LegalAction } from './betting';
export { applyAction, isHandComplete, legalActions } from './betting';
