import { describe, expect, it } from 'vitest';

import { BOT_PROFILES, createTable, playTableHand } from '../src/bot';
import type { Position, Range, RangeChart } from '../src/ranges';
import { POSITIONS, STACK_DEPTH_100BB, TABLE_SIZE_6MAX, createChartRegistry } from '../src/ranges';
import { mulberry32 } from '../src/rng';
import { HEURISTIC_VERSION, createBotStrategy } from '../src/strategy';

/**
 * **A stored hand replays only against the engine that played it.**
 *
 * `bot_hands` stores a seed, the seating and hero's own actions, and nothing
 * downstream of the deal — the board, all five opponents' decisions, the
 * showdown and the payouts are all reproduced by running the bots again. So a
 * change to how the bots decide, or to how many rng draws they spend deciding,
 * silently makes every stored hand replay as a *different* hand.
 *
 * `bot_hands.heuristic_version` has existed since migration 0006 for exactly
 * that, and until 12c it never moved, so the column was decorative. This is
 * what makes it mean something.
 *
 * ## Yes, this is a change detector, and that is the point
 *
 * The mutation that produced this file survived every other suite: reverting
 * `HEURISTIC_VERSION` to its old value, while leaving the retuned bot in place,
 * left 1,219 tests green. Nothing connected the version to the behaviour it
 * claims to describe — and a version that can silently fail to move is worse
 * than no version at all, because 12d's review will trust it.
 *
 * So when this goes red, the bots' decisions changed. That is not a failure to
 * be suppressed:
 *
 *   1. Decide whether the change was intended.
 *   2. Bump `HEURISTIC_VERSION` and `BOT_ENGINE_VERSION` in
 *      `apps/web/src/lib/bot/types.ts`, which move together.
 *   3. Update `FINGERPRINT` below.
 *
 * Hands recorded before the bump stay interpretable by the version that played
 * them, which is the whole design.
 */

const OPEN: Range = {
  AA: [{ action: 'raise', size: 2.5, freq: 1 }],
  KK: [{ action: 'raise', size: 2.5, freq: 1 }],
  AKs: [
    { action: 'raise', size: 2.5, freq: 0.6 },
    { action: 'fold', freq: 0.4 },
  ],
  '72o': [{ action: 'fold', freq: 1 }],
};

const DEFEND: Range = {
  AA: [{ action: 'raise', size: 11, freq: 1 }],
  KQo: [
    { action: 'call', freq: 0.7 },
    { action: 'fold', freq: 0.3 },
  ],
};

const chart = (heroPosition: Position, actionSequence: string, ranges: Range): RangeChart => ({
  tableSize: TABLE_SIZE_6MAX,
  stackDepth: STACK_DEPTH_100BB,
  heroPosition,
  actionSequence,
  skillTags: [],
  ranges,
});

/**
 * Both paths, deliberately: a chart the bot opens from and a chart it defends
 * with, so a change to either the chart lookup or the opponent model that reads
 * those same charts moves the fingerprint.
 */
const registry = createChartRegistry({
  version: 'fingerprint',
  published: true,
  charts: [
    chart('UTG', 'rfi', OPEN),
    chart('CO', 'rfi', OPEN),
    chart('BTN', 'rfi', OPEN),
    chart('BB', 'vs_btn_open', DEFEND),
  ],
});

const HANDS = 25;

/**
 * FNV-1a over every action of every hand.
 *
 * A hash rather than a stored transcript because the transcript is a few hundred
 * lines that nobody would read; the assertion is "identical", and a hash says
 * that as well as the text does. Written out rather than imported: the engine
 * has no runtime dependencies and `node:crypto` is not available to it.
 */
function fingerprint(): string {
  let table = createTable({
    players: POSITIONS.map((_, index) => ({
      id: `p${index}`,
      profile: BOT_PROFILES[index % BOT_PROFILES.length]!,
    })),
  });

  const rng = mulberry32(31337);
  const transcript: string[] = [];

  for (let hand = 0; hand < HANDS; hand++) {
    const played = playTableHand(table, {
      rng,
      strategyFor: (player) =>
        createBotStrategy({
          registry,
          chartVersion: 'fingerprint',
          rng,
          trials: 40,
          aggression: player.profile.aggression,
          looseness: player.profile.looseness,
        }),
    });
    table = played.table;

    for (const action of played.hand.actions) {
      transcript.push(`${action.street}:${action.position}:${action.action}:${action.size ?? ''}`);
    }

    // The result, not only the actions: a change that paid the wrong player
    // while everyone acted identically would otherwise be invisible here.
    for (const payout of played.hand.result.payouts) {
      transcript.push(`${payout.position}=${payout.net}`);
    }
  }

  let hash = 0x811c9dc5;
  for (const entry of transcript.join('|')) {
    hash ^= entry.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

/** Moves with HEURISTIC_VERSION. See the file comment before changing either. */
const FINGERPRINT = '7b7b77f7';

describe('the bots’ decisions are pinned to the version that describes them', () => {
  it('plays the same 25 hands it played when this version was set', () => {
    expect(
      fingerprint(),
      'the bots decide differently than they did — see the comment at the top of this file',
    ).toBe(FINGERPRINT);
  });

  it('names the version those hands were played at', () => {
    expect(HEURISTIC_VERSION).toBe('heuristic.2');
  });

  it('is deterministic, so a red result is a real change and not a flake', () => {
    expect(fingerprint()).toBe(fingerprint());
  });
});
