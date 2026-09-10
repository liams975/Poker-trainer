import { describe, expect, it } from 'vitest';

import {
  BOT_PROFILES,
  actInHand,
  createTable,
  finishTableHand,
  playHand,
  playTableHand,
  replayHand,
  positionsFor,
  startTableHand,
  stepHand,
  type HandProgress,
  type Table,
} from '../src/bot';
import { dealHand, legalActions, settleHand } from '../src/game';
import type { Position } from '../src/ranges';
import { POSITIONS } from '../src/ranges';
import { mulberry32 } from '../src/rng';
import { factor, rationale, type Strategy } from '../src/strategy';

/**
 * Driving a hand one step at a time.
 *
 * 12a's `playHand` runs a hand to completion with a strategy in every seat. A
 * person cannot be a strategy — they take as long as they take — so the UI
 * needs to stop when it reaches their seat and hand control over.
 *
 * The trap this file exists to close is **two loops**. Writing a second,
 * UI-shaped loop beside `playHand` would leave the 100,000-hand conservation
 * proof covering a sibling of the code the app actually runs, and the two would
 * drift exactly the way `strategy/explain.ts` warns about. So `playHand` is
 * rewritten over `stepHand`, and the test that matters most here is the one
 * asserting the two produce the same hand.
 */

/** A strategy that always names one action, so a transcript is predictable. */
function always(action: 'fold' | 'check' | 'call', size?: number): Strategy {
  return {
    recommend: () => ({
      frequencies: [{ action, ...(size === undefined ? {} : { size }), freq: 1 }],
      primary: action,
      rationale: rationale([factor('position', 'low', { seat: 'test' })]),
      source: 'chart',
      chartVersion: 'test',
    }),
  };
}

const foldAll = () => always('fold');

/** Calls when there is something to call, checks when there is not. */
const passive: Strategy = {
  recommend: (state, hero) => {
    const legal = legalActions(state);
    const action = legal.some((option) => option.action === 'check') ? 'check' : 'call';

    return {
      frequencies: [{ action, freq: 1 }],
      primary: action,
      rationale: rationale([factor('position', 'low', { seat: hero })]),
      source: 'chart',
      chartVersion: 'test',
    };
  },
};

const start = (seed = 1): HandProgress => dealHand(mulberry32(seed), { tableSize: 6 });

describe('stepHand', () => {
  it('stops at the human seat instead of acting for them', () => {
    const rng = mulberry32(3);
    let progress = start();

    // Walk to hero's turn. UTG acts first preflop, so hero is reached at once.
    const step = stepHand(progress, { rng, strategyFor: foldAll, human: 'UTG' });

    expect(step.kind).toBe('hero');
    expect(step.progress.state.toAct).toBe('UTG');
    // And nothing moved: the same state came back, no action was recorded.
    expect(step.progress.state.history).toEqual(progress.state.history);
    expect(step.progress.state).toBe(progress.state);

    // Calling again returns the same thing. A human seat is not a step that
    // eventually resolves itself — the caller has to supply the action.
    expect(stepHand(step.progress, { rng, strategyFor: foldAll, human: 'UTG' }).kind).toBe('hero');

    // Which the caller does through the primitive `actInHand`, and play resumes.
    progress = actInHand(step.progress, 'fold');
    const next = stepHand(progress, { rng, strategyFor: foldAll, human: 'UTG' });
    expect(next.kind).toBe('acted');
  });

  it('acts for every seat that is not the human', () => {
    const rng = mulberry32(3);
    let progress = start();
    const acted: Position[] = [];

    for (let guard = 0; guard < 20; guard++) {
      const step = stepHand(progress, { rng, strategyFor: foldAll, human: 'BB' });
      if (step.kind === 'hero' || step.kind === 'complete') break;

      progress = step.progress;
      if (step.kind === 'acted') acted.push(step.position);
    }

    // Everyone folds round to the big blind — the small blind included, who is
    // facing a full big blind and is not exempt — so five seats act and the one
    // seat that never does is the human's.
    expect(acted).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB']);
    expect(acted).not.toContain('BB');
  });

  it('reports the action it took, with the seat that took it', () => {
    const rng = mulberry32(3);
    const step = stepHand(start(), { rng, strategyFor: foldAll });

    expect(step.kind).toBe('acted');
    if (step.kind !== 'acted') throw new Error('unreachable');

    expect(step.position).toBe('UTG');
    expect(step.action.action).toBe('fold');
    expect(step.action.street).toBe('preflop');
    // The action reported is the one now on the state's history, not a copy
    // assembled here — a caller animating it is animating what happened.
    expect(step.progress.state.history.at(-1)).toEqual(step.action);
  });

  it('deals the board as a step of its own', () => {
    const rng = mulberry32(3);
    let progress = start();
    const kinds: string[] = [];

    for (let guard = 0; guard < 60; guard++) {
      const step = stepHand(progress, { rng, strategyFor: () => passive });
      kinds.push(step.kind);
      progress = step.progress;
      if (step.kind === 'complete') break;
    }

    // Everyone limps and checks down, so three boards are dealt: flop, turn,
    // river. They are separate steps precisely so the UI can turn cards over
    // between bets rather than having them appear inside somebody's action.
    expect(kinds.filter((kind) => kind === 'deal')).toHaveLength(3);
    expect(kinds.at(-1)).toBe('complete');
    expect(progress.state.board).toHaveLength(5);
  });

  it('reports completion without advancing anything', () => {
    const rng = mulberry32(3);
    let progress = start();

    for (let guard = 0; guard < 60; guard++) {
      const step = stepHand(progress, { rng, strategyFor: foldAll });
      progress = step.progress;
      if (step.kind === 'complete') break;
    }

    expect(progress.state.toAct).toBeUndefined();

    const again = stepHand(progress, { rng, strategyFor: foldAll });
    expect(again.kind).toBe('complete');
    expect(again.progress.state).toBe(progress.state);
  });
});

describe('playHand runs on stepHand', () => {
  /**
   * The load-bearing test of this file.
   *
   * Driving `stepHand` by hand and calling `playHand` must produce the same
   * hand from the same seed — same actions, same board, same result. If they
   * ever diverge there are two implementations of "play a hand" and the
   * simulation only proves one of them.
   */
  it('produces the hand a manual step loop produces', () => {
    // One rng deals *and* samples, in `playHand` and here alike. Same seed and
    // the same order of draws is the whole reason the two agree.
    const manual = () => {
      const rng = mulberry32(808);
      let progress = dealHand(rng, { tableSize: 6 });

      for (let guard = 0; guard < 200; guard++) {
        const step = stepHand(progress, { rng, strategyFor: () => passive });
        progress = step.progress;
        if (step.kind === 'complete') break;
      }

      // Settled too, because `playHand.final` is the state after the pot has
      // moved. Comparing an unsettled state against a settled one compares
      // stacks that are correct and different.
      return settleHand(progress.state).state;
    };

    const viaPlayHand = playHand({
      rng: mulberry32(808),
      strategyFor: () => passive,
      config: { tableSize: 6 },
    }).final;

    const stepped = manual();

    expect(stepped.history).toEqual(viaPlayHand.history);
    expect(stepped.board).toEqual(viaPlayHand.board);
    expect(stepped.seats.map((seat) => seat.stack)).toEqual(
      viaPlayHand.seats.map((seat) => seat.stack),
    );
  });
});

/**
 * The same split, one level up.
 *
 * A `Table` carries what survives a hand — stacks, the button, the rebuy count
 * — and `playTableHand` did all of it in one closed call. The UI needs the
 * seams: deal, hand control over, settle and move the button.
 */
function seatSix(): Table {
  return createTable({
    players: POSITIONS.map((position, index) => ({
      id: `p${index}`,
      profile: BOT_PROFILES[index % BOT_PROFILES.length]!,
    })),
  });
}

const chipsOn = (table: Table): number =>
  Math.round(table.players.reduce((sum, player) => sum + player.stack, 0) * 100) / 100;

describe('startTableHand and finishTableHand', () => {
  it('deals every seat in, at the stacks the table holds', () => {
    const table = seatSix();
    const open = startTableHand(table, mulberry32(2));

    expect(open.progress.state.seats).toHaveLength(6);
    for (const seat of open.progress.state.seats) {
      expect(seat.hole, `${seat.position} was dealt nothing`).toBeDefined();
    }

    // Positions come from the button, not from seat order.
    expect([...open.seats.values()].sort()).toEqual([...POSITIONS].sort());
    expect(open.seats).toEqual(positionsFor(table));
  });

  it('settles, moves the button and rebuys, all on the finish', () => {
    let table = seatSix();
    table = {
      ...table,
      players: table.players.map((player, index) =>
        index === 0 ? { ...player, stack: 0.2 } : player,
      ),
    };

    const rng = mulberry32(11);
    let open = startTableHand(table, rng);

    for (let guard = 0; guard < 200; guard++) {
      const step = stepHand(open.progress, { rng, strategyFor: () => passive });
      open = { ...open, progress: step.progress };
      if (step.kind === 'complete') break;
    }

    const finished = finishTableHand(open);

    expect(finished.table.button).toBe((table.button + 1) % 6);
    expect(finished.table.handsPlayed).toBe(1);
    expect(finished.table.players[0]!.stack).toBe(100);
    expect(finished.table.rebought).toBeGreaterThan(0);
    // The conservation invariant, on the one hand that exercises a rebuy. Both
    // directions since 12c: the seat that won those chips gives back everything
    // above `stackDepth` in the same breath.
    expect(chipsOn(finished.table)).toBeCloseTo(
      chipsOn(table) + finished.table.rebought - finished.table.cashedOut,
      8,
    );
    expect(finished.table.players.reduce((sum, player) => sum + player.net, 0)).toBeCloseTo(0, 8);
  });

  it('squares every seat back to the stack depth, winners included', () => {
    /**
     * The defect this replaces: `finishTableHand` topped a busted seat up and
     * never took a chip off a winner, so a table only ever grew — 10,400bb after
     * 400 hands, with `chartRecommendation` still grading against 100bb charts.
     * Every hand now starts at the depth the charts describe, and what the stack
     * used to say about the sitting moves to `net`.
     */
    const finished = playTableHand(seatSix(), {
      rng: mulberry32(4242),
      strategyFor: () => passive,
    });

    for (const player of finished.table.players) {
      expect(player.stack, `${player.id} did not square up`).toBe(100);
    }

    // Somebody won the blinds, so the nets are not all zero — they just sum to
    // zero. A test that only checked the sum would pass on a table where nothing
    // ever happened.
    expect(finished.table.players.some((player) => player.net !== 0)).toBe(true);
    expect(finished.table.players.reduce((sum, player) => sum + player.net, 0)).toBeCloseTo(0, 8);
  });

  it('is what playTableHand is made of', () => {
    /**
     * The table-level twin of the `playHand` test above: driving the pieces by
     * hand and calling the closed form must produce the same hand and the same
     * table. Otherwise the 100,000-hand conservation proof covers a path the
     * screen does not take.
     */
    const closed = playTableHand(seatSix(), {
      rng: mulberry32(606),
      strategyFor: () => passive,
    });

    const rng = mulberry32(606);
    let open = startTableHand(seatSix(), rng);
    for (let guard = 0; guard < 200; guard++) {
      const step = stepHand(open.progress, { rng, strategyFor: () => passive });
      open = { ...open, progress: step.progress };
      if (step.kind === 'complete') break;
    }
    const manual = finishTableHand(open);

    expect(manual.hand.actions).toEqual(closed.hand.actions);
    expect(manual.hand.result).toEqual(closed.hand.result);
    expect(manual.table.players).toEqual(closed.table.players);
    expect(manual.table.rebought).toBe(closed.table.rebought);
  });
});

describe('replayHand', () => {
  /**
   * Replaying a hand a person played.
   *
   * Two callers need exactly this and it is worth being explicit about why they
   * are the same function. The **server** replays what a client claims happened
   * and writes its own result, so a browser cannot post a hand it did not play.
   * The **review** replays the same hand to recover the state hero faced at each
   * of their decisions, because a chart lookup needs the spot and not just the
   * action.
   *
   * The bots are reproduced rather than stored: same seed, same strategies, and
   * hero's own actions are the only thing that has to be supplied.
   */
  const replayed = (humanActions: readonly { action: 'fold' | 'check' | 'call'; size?: number }[]) =>
    replayHand({
      rng: mulberry32(808),
      strategyFor: () => passive,
      config: { tableSize: 6 },
      human: 'BB',
      humanActions,
    });

  it('reproduces the hand playHand produces, given hero’s own actions', () => {
    // Everyone limps and checks down under `passive`, hero included — so
    // playing hero passively by hand must land on the identical hand.
    const bots = playHand({
      rng: mulberry32(808),
      strategyFor: () => passive,
      config: { tableSize: 6 },
    });

    const hero = bots.actions.filter((action) => action.position === 'BB');
    const replay = replayed(hero.map((action) => ({ action: action.action as 'check' })));

    expect(replay.actions).toEqual(bots.actions);
    expect(replay.final.board).toEqual(bots.final.board);
    expect(replay.result).toEqual(bots.result);
  });

  it('hands back the state hero faced at each decision, and what they did', () => {
    const bots = playHand({
      rng: mulberry32(808),
      strategyFor: () => passive,
      config: { tableSize: 6 },
    });
    const hero = bots.actions.filter((action) => action.position === 'BB');

    const replay = replayed(hero.map((action) => ({ action: action.action as 'check' })));

    expect(replay.decisions).toHaveLength(hero.length);
    for (const [index, decision] of replay.decisions.entries()) {
      // The state is the one *before* the action — hero was still to act.
      expect(decision.state.toAct).toBe('BB');
      expect(decision.action).toEqual(hero[index]);
      expect(decision.state.history).not.toContain(decision.action);
    }
  });

  it('refuses a replay with too few of hero’s actions', () => {
    expect(() => replayed([])).toThrow(/action/i);
  });

  it('refuses a replay with actions the hand never needed', () => {
    const bots = playHand({
      rng: mulberry32(808),
      strategyFor: () => passive,
      config: { tableSize: 6 },
    });
    const hero = bots.actions.filter((action) => action.position === 'BB');

    expect(() =>
      replayed([
        ...hero.map((action) => ({ action: action.action as 'check' })),
        { action: 'check' as const },
      ]),
    ).toThrow(/unused|too many/i);
  });

  it('refuses an action the rules reject', () => {
    // Hero cannot check the big blind into a raise they have not called.
    expect(() =>
      replayHand({
        rng: mulberry32(808),
        strategyFor: () => always('call'),
        config: { tableSize: 6 },
        human: 'UTG',
        humanActions: [{ action: 'check' }],
      }),
    ).toThrow();
  });
});
