import { describe, expect, it } from 'vitest';

import {
  BOT_PROFILES,
  createTable,
  playTableHand,
  positionsFor,
  type Table,
  type TablePlayer,
} from '../src/bot';
import { legalActions } from '../src/game';
import { POSITIONS, createChartRegistry } from '../src/ranges';
import type { Range, RangeChart } from '../src/ranges';
import { mulberry32 } from '../src/rng';
import { createBotStrategy } from '../src/strategy';

/**
 * The exit criterion for Phase 12a: **chips are conserved.**
 *
 * A side-pot bug does not crash and does not look wrong. It quietly pays the
 * wrong player, and the only way to see it from outside is to count the chips
 * before and after and find them different. Everything else in this phase —
 * the layering in `pot.ts`, the odd-chip rule in `settle.ts`, the uncalled
 * return — is verified in the small by its own file; this is the one assertion
 * that catches what those files forgot to think of.
 *
 * The invariant is exact rather than approximate, and rebuys are the only thing
 * that may add chips:
 *
 *     sum(stacks) === startingTotal + rebought
 *
 * Two thousand hands by default, so `pnpm test` stays hermetic and fast.
 * `ENGINE_BOT_HANDS` turns it up, following the `ENGINE_ORACLE_HANDS` precedent
 * the evaluator oracle already set.
 */

const HANDS = Number(process.env.ENGINE_BOT_HANDS ?? 2000);

/**
 * Scaled with the run, not left at vitest's 5s default.
 *
 * At the default 2,000 hands the whole file finishes in well under a second, so
 * this only matters when `ENGINE_BOT_HANDS` turns it up — and there the default
 * timeout fires as "test timed out", which reads exactly like a hang and sent
 * the first 50,000-hand run looking for a conservation bug that was not there.
 */
const TIMEOUT = Math.max(20_000, HANDS * 2);

const OPEN: Range = {
  AA: [{ action: 'raise', size: 2.5, freq: 1 }],
  KK: [{ action: 'raise', size: 2.5, freq: 1 }],
  AKs: [
    { action: 'raise', size: 2.5, freq: 0.75 },
    { action: 'fold', freq: 0.25 },
  ],
  '72o': [{ action: 'fold', freq: 1 }],
};

const chart = (heroPosition: (typeof POSITIONS)[number]): RangeChart => ({
  tableSize: 6,
  stackDepth: 100,
  heroPosition,
  actionSequence: 'rfi',
  skillTags: [],
  ranges: OPEN,
});

const registry = createChartRegistry({
  version: '2026.09.05-1',
  published: true,
  // A partial registry on purpose: five RFI charts and nothing else, which is
  // the shape of the real content. Every other decision falls to the heuristic,
  // so the simulation exercises the fallback on almost every action.
  charts: POSITIONS.filter((position) => position !== 'BB').map(chart),
});

function seatTable(): Table {
  return createTable({
    players: POSITIONS.map((position, index) => ({
      id: `p${index}`,
      profile: BOT_PROFILES[index % BOT_PROFILES.length]!,
    })),
  });
}

const chipsOn = (table: Table): number =>
  Math.round(table.players.reduce((sum, player) => sum + player.stack, 0) * 100) / 100;

function strategyFor(rng: ReturnType<typeof mulberry32>) {
  return (player: TablePlayer) =>
    createBotStrategy({
      registry,
      chartVersion: '2026.09.05-1',
      rng,
      // Low on purpose. The strategy's shape does not change with trial count,
      // and 2,000 hands at 200 runouts a decision is a minute of CI for no
      // extra assurance about anything this file tests.
      trials: 24,
      aggression: player.profile.aggression,
      looseness: player.profile.looseness,
    });
}

describe(`a ${HANDS}-hand session`, () => {
  it('conserves chips exactly, hand after hand', () => {
    const rng = mulberry32(20260905);
    let table = seatTable();
    const opening = chipsOn(table);
    const decide = strategyFor(rng);

    for (let hand = 1; hand <= HANDS; hand++) {
      const played = playTableHand(table, { rng, strategyFor: decide });
      table = played.table;

      expect(
        chipsOn(table),
        `chips went wrong on hand ${hand} — ${JSON.stringify(
          played.hand.result.pots,
        )}`,
      ).toBeCloseTo(opening + table.rebought, 8);
    }

    expect(table.handsPlayed).toBe(HANDS);
  }, TIMEOUT);

  it('never takes an action the rules reject', () => {
    /**
     * `applyAction` throws on an illegal action, so a session that completes has
     * already proved this. Replayed explicitly anyway: the failure would
     * otherwise surface as "hand 1,447 threw" with no indication that legality
     * was the property at stake.
     */
    const rng = mulberry32(7);
    let table = seatTable();
    const decide = strategyFor(rng);

    for (let hand = 0; hand < 40; hand++) {
      const played = playTableHand(table, { rng, strategyFor: decide });
      table = played.table;

      expect(played.hand.actions.length).toBeGreaterThan(0);
      for (const action of played.hand.actions) {
        expect(action.size === undefined || action.size > 0).toBe(true);
      }
    }
  });

  it('terminates every hand', () => {
    // `playHand` throws past MAX_ACTIONS rather than hanging. This is the test
    // that would catch a bot which min-raises forever.
    const rng = mulberry32(99);
    let table = seatTable();
    const decide = strategyFor(rng);

    for (let hand = 0; hand < 60; hand++) {
      const played = playTableHand(table, { rng, strategyFor: decide });
      expect(played.hand.final.toAct).toBeUndefined();
      table = played.table;
    }
  });

  it('replays identically from the same seed', () => {
    const run = () => {
      const rng = mulberry32(4242);
      let table = seatTable();
      const decide = strategyFor(rng);
      const transcript: string[] = [];

      for (let hand = 0; hand < 25; hand++) {
        const played = playTableHand(table, { rng, strategyFor: decide });
        table = played.table;
        transcript.push(
          played.hand.actions.map((a) => `${a.position}:${a.action}${a.size ?? ''}`).join(','),
        );
      }

      return { transcript, stacks: table.players.map((p) => p.stack) };
    };

    expect(run()).toEqual(run());
  });
});

describe('the table between hands', () => {
  it('moves the button one seat every hand', () => {
    const rng = mulberry32(5);
    let table = seatTable();
    const decide = strategyFor(rng);

    const buttonHolder = (t: Table) =>
      [...positionsFor(t).entries()].find(([, position]) => position === 'BTN')![0];

    const first = buttonHolder(table);
    table = playTableHand(table, { rng, strategyFor: decide }).table;
    const second = buttonHolder(table);

    expect(second).not.toBe(first);

    // Six seats, so six more hands from here brings it back to the same player.
    for (let hand = 0; hand < POSITIONS.length; hand++) {
      table = playTableHand(table, { rng, strategyFor: decide }).table;
    }
    expect(buttonHolder(table)).toBe(second);
  });

  it('gives every player every position over an orbit', () => {
    let table = seatTable();
    const seen = new Map<string, Set<string>>();

    for (let hand = 0; hand < POSITIONS.length; hand++) {
      for (const [id, position] of positionsFor(table)) {
        if (!seen.has(id)) seen.set(id, new Set());
        seen.get(id)!.add(position);
      }
      table = { ...table, button: (table.button + 1) % table.players.length };
    }

    for (const [id, positions] of seen) {
      expect(positions.size, `${id} did not see every seat in an orbit`).toBe(POSITIONS.length);
    }
  });

  it('rebuys a player who cannot post, and records what it added', () => {
    const rng = mulberry32(11);
    let table = seatTable();
    const decide = strategyFor(rng);

    // Bust one seat outright, then play a hand and watch it come back.
    table = {
      ...table,
      players: table.players.map((player, index) =>
        index === 0 ? { ...player, stack: 0.2 } : player,
      ),
    };

    const played = playTableHand(table, { rng, strategyFor: decide });

    expect(played.table.players[0]!.stack).toBe(100);
    expect(played.table.rebought).toBeGreaterThan(0);
  });

  it('refuses a table that is not six-handed', () => {
    expect(() =>
      createTable({
        players: [
          { id: 'a', profile: BOT_PROFILES[0]! },
          { id: 'b', profile: BOT_PROFILES[1]! },
        ],
      }),
    ).toThrow(/six|6/i);
  });
});

describe('legalActions stays the source of truth', () => {
  it('offers something at every decision point of a played hand', () => {
    const rng = mulberry32(31);
    const table = seatTable();
    const decide = strategyFor(rng);

    const played = playTableHand(table, { rng, strategyFor: decide });

    // The final state has nobody to act; every state before it had someone,
    // and `playHand` asked `legalActions` at each.
    expect(played.hand.final.toAct).toBeUndefined();
    expect(legalActions(played.hand.final)).toEqual([]);
  });
});
