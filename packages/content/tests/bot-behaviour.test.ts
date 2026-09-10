import { describe, expect, it } from 'vitest';

import type { Table, TablePlayer } from '@poker/engine';
import {
  BOT_PROFILES,
  POSITIONS,
  createBotStrategy,
  createTable,
  mulberry32,
  playTableHand,
} from '@poker/engine';

import { CHART_SET_VERSION, loadChartRegistry } from '../src/chart-set';

/**
 * **Do the bots play poker?**
 *
 * Until 12c nothing asked. Every suite in the repo checked that the bots played
 * *legally* — every action accepted by the rules, every hand terminating, chips
 * conserved to eight decimal places over a hundred thousand hands — and all of
 * it stayed green while the table played like nothing that has ever happened in
 * a cardroom. Measured over 400 hands against these charts:
 *
 * | | 12b | 6-max poker |
 * |---|---|---|
 * | Facing a bet postflop: raise | **41.0%** | ~8% |
 * | Facing a bet postflop: fold | **13.7%** | ~50% |
 * | Somebody all-in | **38.0%** | ~2–3% |
 * | Reached showdown | **63.0%** | ~25% |
 * | Mean pot | **208bb** | ~10bb |
 * | Chips on the table after 400 hands | **10,400bb** | 600bb |
 *
 * So this file is the phase's actual gate, and the bands below are a **product
 * spec** — "an opponent worth playing against" — not solver output. They are
 * deliberately wide: a heuristic bot is allowed to drift within them, and a
 * suite that failed on a two-point move would be retuned into uselessness the
 * first time it went red.
 *
 * It lives in `packages/content` for the reason `strategy.test.ts` gives: the
 * dependency runs content → engine, so the engine cannot import the charts, and
 * this is the only place the real charts and the real strategy meet. Measuring
 * against a synthetic registry would band a different bot from the one people
 * play — which is precisely the mistake that produced the 12b numbers above.
 */

const registry = loadChartRegistry();

/**
 * The production trial count, from `apps/web/src/lib/bot/types.ts`.
 *
 * Not turned down for speed, and that is not fussiness: the trial count changes
 * behaviour. At 24 runouts a decision the equity estimate is noisy enough to
 * cross `weigh`'s thresholds far more often, and the same constants measure at
 * 8.2% raising instead of 3.9%. A band fitted at one count says nothing about a
 * bot running at another, so this runs at the one people actually face.
 */
const TRIALS = 200;

const SEEDS = [20260909, 1, 777] as const;
const HANDS = 300;

interface Measurement {
  hands: number;
  /** Postflop decisions taken with a live bet in front of them. */
  faced: number;
  facedRaise: number;
  facedFold: number;
  allIn: number;
  showdown: number;
  sawFlop: number;
  potTotal: number;
  /** Hands dealt and hands entered voluntarily, per profile id. */
  dealt: Map<string, number>;
  vpip: Map<string, number>;
  finalTables: Table[];
}

function bump(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function measure(): Measurement {
  const m: Measurement = {
    hands: 0,
    faced: 0,
    facedRaise: 0,
    facedFold: 0,
    allIn: 0,
    showdown: 0,
    sawFlop: 0,
    potTotal: 0,
    dealt: new Map(),
    vpip: new Map(),
    finalTables: [],
  };

  for (const seed of SEEDS) {
    const rng = mulberry32(seed);
    let table = createTable({
      players: POSITIONS.map((_, index) => ({
        id: `p${index}`,
        profile: BOT_PROFILES[index % BOT_PROFILES.length]!,
      })),
    });

    const strategyFor = (player: TablePlayer) =>
      createBotStrategy({
        registry,
        chartVersion: CHART_SET_VERSION,
        rng,
        trials: TRIALS,
        aggression: player.profile.aggression,
        looseness: player.profile.looseness,
      });

    for (let hand = 0; hand < HANDS; hand++) {
      const played = playTableHand(table, { rng, strategyFor });

      // Seating for the hand just played, read before the button moves.
      const profileAt = new Map<string, string>();
      for (const player of table.players) {
        profileAt.set(played.seats.get(player.id)!, player.profile.id);
      }
      table = played.table;
      m.hands += 1;

      const { actions, result, final } = played.hand;

      if (result.showdown !== undefined) m.showdown += 1;
      if (final.seats.some((seat) => seat.status === 'allin')) m.allIn += 1;
      if (actions.some((action) => action.street === 'flop')) m.sawFlop += 1;
      m.potTotal += result.pots.reduce((sum, pot) => sum + pot.amount, 0);

      const voluntary = new Set<string>();
      for (const action of actions) {
        if (action.street !== 'preflop') continue;
        if (action.action !== 'fold' && action.action !== 'check') voluntary.add(action.position);
      }
      for (const position of POSITIONS) {
        const profile = profileAt.get(position)!;
        bump(m.dealt, profile);
        if (voluntary.has(position)) bump(m.vpip, profile);
      }

      // A decision "faces a bet" when somebody has already put chips in on this
      // street. Preflop is excluded because the blinds make every hand face one,
      // and because most preflop decisions come from the charts rather than from
      // the heuristic this file is really measuring.
      let street = '';
      let live = false;
      for (const action of actions) {
        if (action.street !== street) {
          street = action.street;
          live = false;
        }

        if (street !== 'preflop' && live) {
          m.faced += 1;
          if (action.action === 'raise' || action.action === 'allin') m.facedRaise += 1;
          if (action.action === 'fold') m.facedFold += 1;
        }

        if (['bet', 'raise', 'allin'].includes(action.action)) live = true;
      }
    }

    m.finalTables.push(table);
  }

  return m;
}

/** One run, shared by every assertion. Three seeds of 300 hands is ~2s. */
const played = measure();

const share = (part: number, whole: number) => (part / whole) * 100;

describe('the bots, facing a bet', () => {
  /**
   * The single number 12c turned on.
   *
   * `weigh` gave `call` a weight of `1 - 2|edge|` — a tent peaking at a
   * *marginal* call and collapsing to its floor for anything strong. A hand that
   * was well ahead could not call, only raise; the bettor re-raised off the same
   * broken shape, and the stacks went in by the turn.
   */
  it('raises about as often as a person does, not four times in ten', () => {
    expect(share(played.facedRaise, played.faced)).toBeGreaterThan(3);
    expect(share(played.facedRaise, played.faced)).toBeLessThan(16);
  });

  it('folds, which it essentially never used to do', () => {
    expect(share(played.facedFold, played.faced)).toBeGreaterThan(33);
    expect(share(played.facedFold, played.faced)).toBeLessThan(62);
  });
});

describe('the shape of a session', () => {
  it('does not put the stacks in every third hand', () => {
    expect(share(played.allIn, played.hands)).toBeLessThan(8);
  });

  it('reaches a showdown about a fifth of the time', () => {
    expect(share(played.showdown, played.hands)).toBeGreaterThan(10);
    expect(share(played.showdown, played.hands)).toBeLessThan(35);
  });

  it('sees a flop about half the time', () => {
    expect(share(played.sawFlop, played.hands)).toBeGreaterThan(30);
    expect(share(played.sawFlop, played.hands)).toBeLessThan(62);
  });

  it('plays pots measured in blinds, not in stacks', () => {
    const mean = played.potTotal / played.hands;

    expect(mean).toBeGreaterThan(6);
    expect(mean).toBeLessThan(25);
  });
});

describe('the table itself', () => {
  it('is still six hundred blinds at the end of every sitting', () => {
    // 12b topped losers up and never took a chip off a winner, so the table
    // climbed to 10,400bb — and `chartRecommendation` went on grading against
    // 100bb charts the whole way.
    for (const table of played.finalTables) {
      const chips = table.players.reduce((sum, player) => sum + player.stack, 0);
      expect(chips).toBeCloseTo(table.players.length * table.stackDepth, 8);
    }
  });

  it('is zero-sum: one seat is up exactly as much as the others are down', () => {
    for (const table of played.finalTables) {
      expect(table.players.reduce((sum, player) => sum + player.net, 0)).toBeCloseTo(0, 8);
      expect(
        table.players.some((player) => player.net !== 0),
        'a sitting where nobody won or lost anything is not a measurement',
      ).toBe(true);
    }
  });
});

describe('the profiles are three different opponents', () => {
  /**
   * Only the extremes are pinned, and deliberately.
   *
   * The middle profile lands between the other two on most seeds and crosses the
   * rock on some — 21.2% against 20.7% on one of the four measured. Asserting a
   * strict ordering of all three would be a test that fails on the seed rather
   * than on the behaviour, which is the failure mode that gets a suite retuned
   * until it means nothing.
   *
   * PFR is not asserted at all: opening ranges come from the charts, which know
   * nothing about profiles, so the three sit within a point of each other by
   * design rather than by accident.
   */
  const vpip = (id: string) => share(played.vpip.get(id) ?? 0, played.dealt.get(id) ?? 1);

  it('has every seat entering a plausible share of pots', () => {
    for (const profile of BOT_PROFILES) {
      expect(vpip(profile.id), `${profile.label} plays a strange share of hands`).toBeGreaterThan(14);
      expect(vpip(profile.id), `${profile.label} plays a strange share of hands`).toBeLessThan(38);
    }
  });

  it('has the loose seat playing clearly more hands than the tight one', () => {
    expect(vpip('aggressor') - vpip('rock')).toBeGreaterThan(3);
  });
});
