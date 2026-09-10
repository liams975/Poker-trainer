'use client';

import type {
  ChartSet,
  Combo,
  HandResult,
  HeroDecision,
  OpenTableHand,
  Position,
  ReviewedDecision,
  Table,
} from '@poker/engine';
import {
  BOT_PROFILES,
  actInHand,
  createChartRegistry,
  createTable,
  finishTableHand,
  formatCard,
  handNotationOf,
  legalActions,
  positionsFor,
  potBetSizes,
  reviewHandDecisions,
  startTableHand,
  stepHand,
} from '@poker/engine';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildChoices, DecisionControls, type Choice } from '@/components/drill/decision-controls';
import { PokerTable } from '@/components/drill/poker-table';
import { Button } from '@/components/ui/button';
import { endBotSession, recordBotHand, startBotSession } from '@/lib/bot/client';
import {
  botStrategies,
  type BotHandClaim,
  type HeroAction,
  type SeatProfiles,
} from '@/lib/bot/types';

import { HandSummary } from './hand-summary';

/**
 * A seat at a six-handed cash table.
 *
 * All the poker lives in `@poker/engine` — the deal, legality, sampling, the
 * side pots, the showdown, the button and the rebuy. This component owns
 * sequencing, timing and when to talk to the server, and nothing else
 * (CLAUDE.md: never put poker logic in a React component).
 *
 * **One loop, not two.** Every step goes through `stepHand`, the same function
 * `playTableHand` runs inside the 100,000-hand conservation simulation. The
 * only difference is the `human` option, which makes it stop at hero's seat
 * rather than sampling an action there. A separate UI-shaped loop would mean
 * the simulation proves a sibling of the code you are actually playing.
 *
 * ## The rng is a ref, and that is load-bearing
 *
 * `mulberry32` is a mutable stream: every draw advances it. The server replays
 * this hand from the same seed and has to consume the same draws in the same
 * order — so the rng cannot live in state, where React would hand back a stale
 * copy, and a step must never run twice. Every advance is scheduled through one
 * timer whose cleanup cancels it, which is also what makes React's
 * double-invoked development effects harmless: the first schedule is cleared
 * before it can fire.
 *
 * ## No feedback until the hand is over
 *
 * Grades appear in the summary, never mid-hand. A tier landing on your preflop
 * call while you still have the flop to play is the drill's moment in a place
 * it does not belong.
 */

/** Milliseconds between beats. Long enough to read, short enough to play. */
const BEAT_MS = 620;

/** Hero's id at the table. The five bots take the rest. */
const HERO_ID = 'you';

type Phase = 'running' | 'hero' | 'complete';

interface OpenHand {
  open: OpenTableHand;
  seed: number;
  heroPosition: Position;
  profiles: SeatProfiles;
  button: number;
  /** Stacks at the deal — what the hand replays from, captured before it moves. */
  stacks: Partial<Record<Position, number>>;
}

/**
 * A fresh seed per hand.
 *
 * Not `Math.random()` — CLAUDE.md bans it outright, and this number is the root
 * of the hand's reproducibility: it is stored on the row and regenerates the
 * deal, the board and all five opponents' decisions. `getRandomValues` is the
 * platform's proper source and is uniform over the whole uint32 range, which
 * `mulberry32` expects.
 *
 * Per hand rather than derived from one session seed, so every stored hand is
 * self-sufficient: replaying one never requires replaying the ones before it.
 */
function freshSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** Six seats: hero, and five opponents cycling through the three profiles. */
function seatTable(): Table {
  const bots = [0, 1, 2, 0, 1].map((index, seat) => ({
    id: `bot-${seat}`,
    profile: BOT_PROFILES[index]!,
  }));

  return createTable({ players: [{ id: HERO_ID, profile: BOT_PROFILES[1]! }, ...bots] });
}

const holeOf = (combo: Combo): readonly [string, string] => [
  formatCard(combo[0]),
  formatCard(combo[1]),
];

export function BotTableRunner({ chartSet }: { chartSet: ChartSet }) {
  const registry = useMemo(() => createChartRegistry(chartSet), [chartSet]);
  const reduced = useReducedMotion();
  const beat = reduced ? 0 : BEAT_MS;

  const [table, setTable] = useState<Table>(seatTable);
  const [hand, setHand] = useState<OpenHand | null>(null);
  const [phase, setPhase] = useState<Phase>('running');
  const [boardShown, setBoardShown] = useState(0);
  const [result, setResult] = useState<HandResult | null>(null);
  const [decisions, setDecisions] = useState<readonly HeroDecision[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [handNo, setHandNo] = useState(0);

  /** This hand's rng and opponents. Mutable, so never state. */
  const engine = useRef<ReturnType<typeof botStrategies> | null>(null);
  /** Hero's own actions this hand, and the spots they were taken in. */
  const heroActions = useRef<HeroAction[]>([]);
  const heroSpots = useRef<ReviewedDecision[]>([]);
  /** Hands that finished before the sitting's id arrived. See `record`. */
  const pending = useRef<Omit<BotHandClaim, 'sessionId'>[]>([]);

  /**
   * The sitting. Opened once; a failure here costs the history, never the play.
   *
   * `ignore` rather than an abort: by the time a development double-mount tears
   * this down the POST has already written a row, and abandoning it would leave
   * a session nothing ever closes.
   */
  useEffect(() => {
    let ignore = false;

    startBotSession({ stackDepth: 100, bigBlind: 1, profiles: {} })
      .then(({ sessionId: id }) => {
        if (!ignore) setSessionId(id);
      })
      .catch((cause: unknown) => {
        if (!ignore) {
          setRecordingError(cause instanceof Error ? cause.message : 'the session could not start');
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const deal = useCallback(() => {
    const seed = freshSeed();
    const seats = positionsFor(table);
    const heroPosition = seats.get(HERO_ID)!;

    const profiles: SeatProfiles = {};
    const stacks: Partial<Record<Position, number>> = {};
    for (const player of table.players) {
      const position = seats.get(player.id)!;
      stacks[position] = player.stack;
      if (player.id !== HERO_ID) profiles[position] = player.profile.id;
    }

    // Built through the shared factory, not a local copy of it: the server
    // constructs the opponents the same way from the same seed, and a
    // difference of one Monte Carlo trial would desynchronise the whole hand.
    const running = botStrategies(profiles, {
      registry,
      chartVersion: chartSet.version,
      seed,
    });

    engine.current = running;
    heroActions.current = [];
    heroSpots.current = [];

    setHand({
      open: startTableHand(table, running.rng),
      seed,
      heroPosition,
      profiles,
      button: table.button,
      stacks,
    });
    setBoardShown(0);
    setResult(null);
    setDecisions([]);
    setPhase('running');
  }, [table, registry, chartSet.version]);

  /** Posts one finished hand. Its failure is reported, never thrown at play. */
  const send = useCallback((claim: Omit<BotHandClaim, 'sessionId'>, id: string) => {
    recordBotHand({ ...claim, sessionId: id })
      .then(() => setRecordingError(null))
      .catch((cause: unknown) =>
        setRecordingError(cause instanceof Error ? cause.message : 'it could not be saved'),
      );
  }, []);

  /**
   * Records the finished hand, or holds it until there is a sitting to file it
   * under.
   *
   * **The wait is real, not theoretical.** The session POST is in flight while
   * the first hand is already dealing, and a hand where everyone folds preflop
   * is over in a couple of seconds. Returning early here — which is what this
   * did — dropped that hand with no error shown, which is the single failure
   * mode this whole path exists to avoid.
   */
  const record = useCallback(
    (finished: OpenHand, actions: readonly HeroAction[], number: number) => {
      const claim: Omit<BotHandClaim, 'sessionId'> = {
        handNo: number,
        seed: finished.seed,
        button: finished.button,
        heroPosition: finished.heroPosition,
        stacks: finished.stacks,
        profiles: finished.profiles,
        heroActions: actions,
      };

      if (sessionId === null) {
        pending.current = [...pending.current, claim];
        return;
      }

      send(claim, sessionId);
    },
    [sessionId, send],
  );

  // The flush. `setRecordingError` only ever runs inside `send`'s promise
  // callbacks, so nothing here sets state synchronously in an effect body.
  useEffect(() => {
    if (sessionId === null || pending.current.length === 0) return;

    const queued = pending.current;
    pending.current = [];
    for (const claim of queued) send(claim, sessionId);
  }, [sessionId, send]);

  /**
   * One beat: reveal a street, take a bot's action, or end the hand.
   *
   * Only ever called from the timer below, exactly once per schedule.
   */
  const advance = useCallback(() => {
    // No hand on the table: deal one. The first hand and every hand after it
    // arrive through this same beat, which is also why dealing is not done
    // synchronously in an effect — `react-hooks/set-state-in-effect` rejects
    // that, and it is right to: the deal is a tick of the clock, not a
    // synchronisation with an external system.
    if (hand === null) {
      deal();
      return;
    }

    const current = hand;
    const running = engine.current;
    if (running === null) return;

    const state = current.open.progress.state;

    /**
     * The board catches up first.
     *
     * `advanceHand` deals all five at once when everyone is all-in — the hand
     * is already over and `applyAction` has walked the streets out on its own.
     * Revealing to the next street boundary rather than straight to
     * `board.length` turns that back into flop, turn, river, at the one moment
     * in poker where the cards arriving separately is the entire point.
     */
    if (boardShown < state.board.length) {
      setBoardShown(boardShown < 3 ? Math.min(3, state.board.length) : boardShown + 1);
      return;
    }

    const step = stepHand(current.open.progress, {
      rng: running.rng,
      strategyFor: running.strategyFor,
      human: current.heroPosition,
    });

    if (step.kind === 'hero') {
      setPhase('hero');
      return;
    }

    if (step.kind === 'complete') {
      const finished = finishTableHand({ ...current.open, progress: step.progress });

      setResult(finished.hand.result);
      setDecisions(
        reviewHandDecisions(heroSpots.current, { registry, chartVersion: chartSet.version }),
      );
      setTable(finished.table);
      setPhase('complete');
      record(current, heroActions.current, handNo);
      return;
    }

    setHand({ ...current, open: { ...current.open, progress: step.progress } });
  }, [hand, deal, boardShown, registry, chartSet.version, record, handNo]);

  // The clock. Cleanup cancels the pending beat, which is what makes React's
  // double-invoked development effects harmless: the rng advances once.
  useEffect(() => {
    if (phase !== 'running') return;

    const timer = setTimeout(advance, beat);
    return () => clearTimeout(timer);
  }, [phase, advance, beat]);

  const answer = useCallback(
    (choice: Choice) => {
      const current = hand;
      if (current === null || phase !== 'hero') return;

      const before = current.open.progress.state;
      const next = actInHand(current.open.progress, choice.action, choice.size);

      heroActions.current = [
        ...heroActions.current,
        { action: choice.action, ...(choice.size === undefined ? {} : { size: choice.size }) },
      ];
      // Recorded as it happens rather than replayed afterwards: the state hero
      // faced is right here, and a second derivation of it could disagree.
      heroSpots.current = [
        ...heroSpots.current,
        { state: before, action: next.state.history[next.state.history.length - 1]! },
      ];

      setHand({ ...current, open: { ...current.open, progress: next } });
      setPhase('running');
    },
    [hand, phase],
  );

  const nextHand = useCallback(() => {
    setHandNo((played) => played + 1);
    setHand(null);
    setPhase('running');
  }, []);

  const leave = useCallback(() => {
    if (sessionId !== null) void endBotSession(sessionId).catch(() => undefined);
  }, [sessionId]);

  if (hand === null) {
    return <p className="text-sm text-ink-muted">Dealing…</p>;
  }

  const state = hand.open.progress.state;
  const heroSeat = state.seats.find((seat) => seat.position === hand.heroPosition)!;
  const choices =
    phase === 'hero' ? buildChoices(legalActions(state), potBetSizes(state)) : [];

  return (
    <div className="flex flex-col gap-6 2xl:flex-row 2xl:items-start">
      <div className="flex flex-1 flex-col gap-4 rounded-[var(--radius)] border border-line bg-surface p-5">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-sm font-semibold">
            You are {hand.heroPosition} · {heroSeat.stack}bb
          </h2>
          <span className="font-mono text-xs text-ink-muted" data-testid="hand-count">
            Hand {handNo + 1}
          </span>
        </header>

        <PokerTable
          state={state}
          hero={hand.heroPosition}
          {...(heroSeat.hole === undefined
            ? {}
            : {
                hole: holeOf(heroSeat.hole),
                hand: handNotationOf(heroSeat.hole[0], heroSeat.hole[1]),
              })}
          dealKey={String(hand.seed)}
          boardShown={boardShown}
          faceDownOpponents
          {...(result === null ? {} : { result })}
        />
      </div>

      <aside className="flex w-full flex-col gap-4 2xl:w-[26rem]">
        {phase === 'hero' ? (
          <div className="rounded-[var(--radius)] border border-line bg-surface p-5">
            <DecisionControls
              state={state}
              hero={hand.heroPosition}
              choices={choices}
              onAnswer={answer}
            />
          </div>
        ) : null}

        {phase === 'complete' && result !== null ? (
          <div className="flex flex-col gap-4 rounded-[var(--radius)] border border-line bg-surface p-5">
            <HandSummary
              result={result}
              hero={hand.heroPosition}
              decisions={decisions}
              recordingError={recordingError}
            />

            <div className="flex gap-2">
              <Button type="button" onClick={nextHand} data-testid="next-hand">
                Next hand
              </Button>
              <Button asChild variant="outline">
                <Link href="/dashboard" onClick={leave}>
                  Leave table
                </Link>
              </Button>
            </div>
          </div>
        ) : null}

        {phase === 'running' ? (
          <p className="text-xs text-ink-muted" data-testid="waiting">
            Waiting on the other seats…
          </p>
        ) : null}
      </aside>
    </div>
  );
}
