/**
 * A cash table between hands.
 *
 * The state that survives a hand — who is sitting where, what they have left,
 * where the button is — and the two rules that move it: the button rotates, and
 * a player who cannot post a blind rebuys.
 *
 * Both are poker decisions, so both live here rather than in React. CLAUDE.md:
 * "Never put poker logic in a React component."
 *
 * The subtlety worth stating: this engine addresses seats by **position**
 * (`UTG`…`BB`), not by seat number, because that is what a chart key needs. So
 * "the button moves" is really "every player's position changes", and
 * `positionsFor` is where that happens.
 */

import type { HandConfig } from '../game';
import { dealHand, settleHand } from '../game';
import type { Position } from '../ranges';
import { POSITIONS } from '../ranges';
import type { Rng } from '../rng';
import type { Strategy } from '../strategy';

import type { PlayedHand } from './hand';
import type { BotProfile } from './profile';
import type { HandProgress } from './step';
import { MAX_STEPS, stepHand } from './step';

/** Where the button sits in `POSITIONS`. */
const BUTTON_INDEX = POSITIONS.indexOf('BTN');

export interface TablePlayer {
  id: string;
  stack: number;
  profile: BotProfile;
  /**
   * What this seat is up or down across the whole sitting, in big blinds.
   *
   * The number the stack used to carry, and the one a player actually wants.
   * Since 12c every seat starts each hand at `stackDepth`, so a stack no longer
   * says anything about how the session has gone — this does, and it says it
   * without dragging the table away from the depth the charts describe.
   */
  net: number;
}

export interface Table {
  /** In seating order. Index 0 is arbitrary and never changes. */
  players: readonly TablePlayer[];
  /** Index into `players` of whoever currently holds the button. */
  button: number;
  handsPlayed: number;
  /**
   * Chips added by topping a seat back up to `stackDepth`, since the table
   * opened.
   */
  rebought: number;
  /**
   * Chips taken off a seat that finished a hand above `stackDepth`.
   *
   * The counterpart 12b was missing. `finishTableHand` topped losers up and
   * never took anything off a winner, so the table total only ever climbed: by
   * hand 400 the average stack was around 1,700bb while `chartRecommendation`
   * was still grading against 100bb charts. Both directions are tracked, so the
   * books balance:
   *
   *     sum(stacks) === startingTotal + rebought - cashedOut
   *
   * and, more usefully, the two invariants that follow from resetting:
   *
   *     sum(stacks) === players.length * stackDepth
   *     sum(net)    === 0
   */
  cashedOut: number;
  stackDepth: number;
  bigBlind: number;
}

export interface CreateTableOptions {
  players: readonly { id: string; profile: BotProfile }[];
  stackDepth?: number;
  bigBlind?: number;
  button?: number;
}

export function createTable(options: CreateTableOptions): Table {
  const { players, stackDepth = 100, bigBlind = 1, button = 0 } = options;

  /**
   * Six, exactly.
   *
   * Short-handed play is not a smaller version of this — `createHandState`
   * drops the *earliest* positions, so a four-handed table is CO/BTN/SB/BB and
   * heads-up has no button seat at all in this model. Those are real position
   * rules and inventing them here to make a test easier would put made-up poker
   * in the engine. 6-max is the locked scope; when short-handed arrives it
   * arrives with its own charts.
   */
  if (players.length !== POSITIONS.length) {
    throw new RangeError(
      `a table seats exactly ${POSITIONS.length} players, got ${players.length}`,
    );
  }
  if (button < 0 || button >= players.length) {
    throw new RangeError(`the button must be a seat index, got ${button}`);
  }

  return {
    players: players.map((player) => ({ ...player, stack: stackDepth, net: 0 })),
    button,
    handsPlayed: 0,
    rebought: 0,
    cashedOut: 0,
    stackDepth,
    bigBlind,
  };
}

/**
 * Which position each player holds this hand.
 *
 * The player on the button takes `BTN`, and everyone clockwise from them takes
 * the next position round. Returned by player id, because a player's id is the
 * thing that persists and their position is the thing that does not.
 */
export function positionsFor(table: Table): ReadonlyMap<string, Position> {
  const count = table.players.length;
  const seats = new Map<string, Position>();

  table.players.forEach((player, index) => {
    const fromButton = (index - table.button + count) % count;
    seats.set(player.id, POSITIONS[(BUTTON_INDEX + fromButton) % count]!);
  });

  return seats;
}

export interface PlayTableHandOptions {
  rng: Rng;
  /** The strategy a given player uses. Profiles are on the player. */
  strategyFor: (player: TablePlayer) => Strategy;
}

export interface TableHand {
  table: Table;
  hand: PlayedHand;
  /** Which position each player held, for the stored hand history. */
  seats: ReadonlyMap<string, Position>;
}

/**
 * A hand in progress at a table: the cards, and who is sitting where.
 *
 * The pair is what a caller needs and cannot recompute. `seats` is derived from
 * the button, which `finishTableHand` moves — so reading it back off the table
 * afterwards would give the *next* hand's seating and quietly credit the wrong
 * player.
 */
export interface OpenTableHand {
  table: Table;
  seats: ReadonlyMap<string, Position>;
  progress: HandProgress;
}

/** The hand config this table's current seating implies. */
export function tableHandConfig(table: Table, seats: ReadonlyMap<string, Position>): HandConfig {
  const stacks: Partial<Record<Position, number>> = {};
  for (const player of table.players) stacks[seats.get(player.id)!] = player.stack;

  return {
    tableSize: table.players.length,
    stackDepth: table.stackDepth,
    bigBlind: table.bigBlind,
    smallBlind: table.bigBlind / 2,
    stacks,
  };
}

/** Seats everyone by the button and deals. Nothing has acted yet. */
export function startTableHand(table: Table, rng: Rng): OpenTableHand {
  const seats = positionsFor(table);

  return { table, seats, progress: dealHand(rng, tableHandConfig(table, seats)) };
}

/** Two decimals, matching the money column everything else rounds to. */
function chips(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Settles the hand and returns the table as it stands afterwards.
 *
 * The button moves and the stacks are squared up here rather than at the start
 * of the next hand, so a `Table` is always in a playable state: every stack can
 * post, and the button is already where the next deal wants it.
 *
 * **Every seat goes back to `stackDepth`.** 12b topped a busted seat up and
 * never took chips off a winner, so the table total only ever rose — 10,400bb
 * on the table after 400 hands, and an average stack of 1,700bb being graded
 * against 100bb charts. Resetting is what keeps every hand the spot the charts
 * describe, which for a *trainer* is the whole point: you are here to practise
 * 100bb 6-max, not to be carried into 17x-deep pots nobody has authored a chart
 * for. What the stack used to tell you moves to `net`, which tells it better.
 */
export function finishTableHand(open: OpenTableHand): TableHand {
  const { table, seats, progress } = open;

  const { state: final, result } = settleHand(progress.state);
  const hand: PlayedHand = { final, result, actions: progress.state.history };

  let rebought = 0;
  let cashedOut = 0;

  const players = table.players.map((player) => {
    const seat = final.seats.find((candidate) => candidate.position === seats.get(player.id))!;

    // What the hand cost or paid this seat. The stacks it sits between are the
    // one at the deal and the one after the pot is awarded, so this is exact
    // and sums to zero across the table.
    const delta = chips(seat.stack - player.stack);

    if (seat.stack < table.stackDepth) rebought += table.stackDepth - seat.stack;
    else cashedOut += seat.stack - table.stackDepth;

    return { ...player, stack: table.stackDepth, net: chips(player.net + delta) };
  });

  return {
    table: {
      ...table,
      players,
      button: (table.button + 1) % table.players.length,
      handsPlayed: table.handsPlayed + 1,
      rebought: chips(table.rebought + rebought),
      cashedOut: chips(table.cashedOut + cashedOut),
    },
    hand,
    seats,
  };
}

/**
 * One whole hand, with a strategy in every seat.
 *
 * Start, step, finish — the same three pieces the screen uses, in a closed
 * loop. That is deliberate and it is what makes the simulation worth anything:
 * the 100,000-hand conservation run exercises the path the app takes, not a
 * sibling of it.
 */
export function playTableHand(table: Table, options: PlayTableHandOptions): TableHand {
  const open = startTableHand(table, options.rng);

  const byPosition = new Map<Position, TablePlayer>();
  for (const player of table.players) byPosition.set(open.seats.get(player.id)!, player);

  let progress = open.progress;

  for (let step = 0; ; step++) {
    if (step > MAX_STEPS) {
      throw new RangeError(`a hand took more than ${MAX_STEPS} steps; it is not terminating`);
    }

    const taken = stepHand(progress, {
      rng: options.rng,
      strategyFor: (position) => options.strategyFor(byPosition.get(position)!),
    });
    progress = taken.progress;

    if (taken.kind === 'complete') break;
  }

  return finishTableHand({ ...open, progress });
}
