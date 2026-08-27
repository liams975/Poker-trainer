'use client';

import type {
  Answer,
  ChartSet,
  DrillTemplate,
  Grade,
  RangeChart,
  Rationale,
  SessionSpot,
  SessionSummary as Summary,
} from '@poker/engine';
import {
  createChartRegistry,
  createChartStrategy,
  generateSession,
  gradeAnswer,
  legalActions,
  lookupChart,
  mulberry32,
  potSize,
  raiseSizeOptions,
  summariseSession,
} from '@poker/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { chartLabel } from '@/lib/charts/map';
import { finishSession, recordAttempt, startSession } from '@/lib/drills/client';

import { buildChoices, DecisionControls, type Choice } from './decision-controls';
import { FeedbackPanel } from './feedback-panel';
import { SessionConfigForm, type SessionConfig } from './session-config';
import { SessionSummary } from './session-summary';
import { actionForKey, isShortcutTarget } from './shortcuts';
import { ShortcutsOverlay } from './shortcuts-overlay';
import { SpotView } from './spot-view';

/**
 * The core loop: configure, answer, see why, next.
 *
 * All the poker lives in `@poker/engine` — session generation, legality,
 * grading, sizing options and the summary. This component owns sequencing,
 * keystrokes and when to talk to the server, and nothing else (CLAUDE.md: never
 * put poker logic in a React component).
 *
 * The browser grades locally so the tier lands with no spinner, which docs/05
 * makes a requirement of the feedback moment. It is not what gets stored:
 * `recordAttempt` re-derives the whole thing server-side and writes its own
 * result. See lib/drills/record.ts, which the /api/drill routes call.
 */

/** Endless sessions come in batches; 25 is a session's worth at a time. */
const BATCH = 25;

/**
 * How long the summary waits for outstanding attempts before showing anyway.
 * Reaching the summary should mean the history is written — but not at the cost
 * of trapping someone behind one stalled request.
 */
const FINISH_TIMEOUT_MS = 5_000;

/**
 * A fresh session seed.
 *
 * Not `Math.random()` — CLAUDE.md bans it outright, and this number is the root
 * of the session's reproducibility: it is stored in `drill_sessions.config` and
 * regenerates every spot. `getRandomValues` is the platform's proper source and
 * is uniform over the whole uint32 range, which `mulberry32` expects.
 */
function freshSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** Deterministic per-batch seed, so an endless session still replays. */
function batchSeed(sessionSeed: number, batch: number): number {
  if (batch === 0) return sessionSeed;

  const rng = mulberry32(sessionSeed);
  let seed = sessionSeed;
  for (let i = 0; i < batch; i++) seed = rng.nextUint32();
  return seed;
}

interface Reveal {
  grade: Grade;
  answer: Answer;
  rationale: Rationale | null;
}

type Phase = 'configuring' | 'running' | 'finished';

export type RunnerMode = 'quick' | 'focused' | 'lesson' | 'placement' | 'study';

export interface FinishedSession {
  sessionId: string | null;
  summary: Summary;
}

export interface DrillRunnerProps {
  chartSet: ChartSet;
  templates: readonly { id: string; template: DrillTemplate }[];
  mode: RunnerMode;
  /**
   * Skips the config screen and starts immediately.
   *
   * This is how a lesson's embedded drill and the placement diagnostic reuse
   * the runner rather than reimplementing it. One grading path, not two: a
   * parallel mini-runner could drift from the real one, and the whole risk of
   * a teaching app is contradicting yourself between the lesson and the drill.
   */
  preset?: SessionConfig | undefined;
  /** When given, the caller renders the ending instead of the built-in summary. */
  onFinished?: ((result: FinishedSession) => void) | undefined;
}

function SpotTimer({ startedAt }: { startedAt: number }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))),
      250,
    );
    return () => clearInterval(id);
  }, [startedAt]);

  // Counting up, never down. A countdown would add a fail state the engine does
  // not model, and docs/05's tone is "a coach nodding, not a slot machine".
  return (
    <span className="font-mono text-xs text-ink-muted" data-testid="spot-timer">
      {seconds}s
    </span>
  );
}

export function DrillRunner({
  chartSet,
  templates,
  mode,
  preset,
  onFinished,
}: DrillRunnerProps) {
  const registry = useMemo(() => createChartRegistry(chartSet), [chartSet]);
  const strategy = useMemo(
    () => createChartStrategy({ registry, chartVersion: chartSet.version }),
    [registry, chartSet.version],
  );

  const [phase, setPhase] = useState<Phase>('configuring');
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionSeed, setSessionSeed] = useState(0);
  const [batch, setBatch] = useState(0);
  const [spots, setSpots] = useState<readonly SessionSpot[]>([]);
  const [index, setIndex] = useState(0);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [results, setResults] = useState<readonly { tier: Grade['tier']; evLoss: number }[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * When the current spot was put on screen. Drives both the optional timer and
   * `response_ms`, so the number shown and the number stored cannot disagree.
   * State rather than a ref because `Date.now()` during render is impure — the
   * lazy initialiser is the sanctioned way to seed it once.
   */
  const [startedAt, setStartedAt] = useState(() => Date.now());

  /** Bumped whenever the spot on screen changes; see `answer`. */
  const tokenRef = useRef(0);
  /** Where each answer's result sits in `results`, so a late reply corrects it. */
  const resultsCount = useRef(0);
  /** Every attempt still being written, awaited before the session closes. */
  const pending = useRef<Promise<unknown>[]>([]);

  const current = spots[index];

  const bySlug = useMemo(
    () => new Map(templates.map((entry) => [entry.template.slug, entry])),
    [templates],
  );

  const chart: RangeChart | undefined = useMemo(() => {
    if (current === undefined) return undefined;
    return lookupChart(registry, {
      tableSize: 6,
      stackDepth: 100,
      heroPosition: current.spot.scenario.heroPosition,
      actionSequence: current.spot.scenario.actionSequence,
    });
  }, [current, registry]);

  const recommendation = useMemo(() => {
    if (current === undefined) return null;
    try {
      return strategy.recommend(current.spot.state, current.spot.hero);
    } catch {
      return null;
    }
  }, [current, strategy]);

  const choices = useMemo(() => {
    if (current === undefined) return [];
    return buildChoices(
      legalActions(current.spot.state),
      raiseSizeOptions(current.spot.scenario, registry),
    );
  }, [current, registry]);

  const start = useCallback(
    async (chosen: SessionConfig) => {
      setStarting(true);
      setError(null);

      try {
        const seed = freshSeed();
        const chosenTemplates = templates
          .filter((entry) => chosen.templateSlugs.includes(entry.template.slug))
          .map((entry) => entry.template);

        const generated = generateSession({
          templates: chosenTemplates,
          seed,
          count: chosen.length ?? BATCH,
          registry,
        });

        const { sessionId: id } = await startSession({
          mode: chosen.studyMode ? 'study' : mode,
          seed,
          spotsPlanned: chosen.length,
          templateSlugs: chosen.templateSlugs,
        });

        setConfig(chosen);
        setSessionId(id);
        setSessionSeed(seed);
        setBatch(0);
        setSpots(generated);
        setIndex(0);
        setResults([]);
        setReveal(null);
        resultsCount.current = 0;
        pending.current = [];
        tokenRef.current += 1;
        setPhase('running');
        setStartedAt(Date.now());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'could not start the session');
      } finally {
        setStarting(false);
      }
    },
    [mode, registry, templates],
  );

  /**
   * A preset session starts itself. The effect is the right place for it: this
   * is a network call reaching out to an external system on mount, not a piece
   * of derived state. The ref stops React's development double-invoke from
   * opening two sessions.
   */
  const autoStarted = useRef(false);
  useEffect(() => {
    if (preset === undefined || autoStarted.current) return;
    autoStarted.current = true;
    void start(preset);
  }, [preset, start]);

  const answer = useCallback(
    async (choice: Choice) => {
      if (current === undefined || reveal !== null || recommendation === null) return;

      const chosen: Answer = {
        action: choice.action,
        ...(choice.size === undefined ? {} : { size: choice.size }),
      };
      const responseMs = Date.now() - startedAt;

      // Local grade first: the tier has to land without waiting on the network.
      const local = gradeAnswer(
        recommendation.frequencies,
        chosen,
        potSize(current.spot.state),
      );
      setReveal({ grade: local, answer: chosen, rationale: recommendation.rationale });
      setResults((prior) => [...prior, { tier: local.tier, evLoss: local.evLoss }]);

      const template = bySlug.get(current.spot.scenario.templateSlug);
      if (sessionId === null || template === undefined) return;

      /**
       * Which spot this answer belongs to. The user can hit Space before the
       * round trip returns, and without this the late response would paint the
       * previous spot's grade onto the one now on screen — and would then
       * overwrite the wrong entry in `results`. Both were real: the e2e run
       * recorded 7 of 25 attempts, because a stale grade left the next spot
       * looking answered and its keystroke was swallowed.
       */
      const token = tokenRef.current;
      const slot = resultsCount.current;
      resultsCount.current += 1;

      const inFlight = recordAttempt({
        sessionId,
        templateId: template.id,
        scenario: current.spot.scenario,
        seed: current.seed,
        action: chosen.action,
        size: chosen.size,
        responseMs,
        clientTier: local.tier,
      })
        .then((stored) => {
          // The stored grade replaces the local one *only* if we are still
          // looking at the spot it grades.
          if (tokenRef.current === token) {
            setReveal({ grade: stored.grade, answer: chosen, rationale: stored.rationale });
          }
          // The summary is always corrected, by position rather than by "last",
          // since a later answer may already have been appended.
          setResults((prior) =>
            prior.map((entry, i) =>
              i === slot ? { tier: stored.grade.tier, evLoss: stored.grade.evLoss } : entry,
            ),
          );
        })
        .catch((cause: unknown) => {
          setError(
            cause instanceof Error ? cause.message : 'this attempt could not be recorded',
          );
        });

      pending.current.push(inFlight);
      await inFlight;
    },
    [bySlug, current, recommendation, reveal, sessionId, startedAt],
  );

  /**
   * Ends the session only once every attempt has actually landed, so reaching
   * the summary means the history is written — not that it is on its way. A tab
   * closed on the summary screen would otherwise lose the last answer and leave
   * `completed_at` null.
   */
  const finish = useCallback(async () => {
    tokenRef.current += 1;
    setFinishing(true);

    const settle = async () => {
      await Promise.allSettled(pending.current);
      if (sessionId === null) return;
      try {
        await finishSession(sessionId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'could not close the session');
      }
    };

    // Wait for the writes, but never hold someone hostage to a hung request:
    // after this the summary is shown regardless, with whatever landed.
    await Promise.race([
      settle(),
      new Promise((resolve) => setTimeout(resolve, FINISH_TIMEOUT_MS)),
    ]);

    pending.current = [];
    setFinishing(false);
    setPhase('finished');

    // Called here rather than from an effect on `phase`: this is the event that
    // ends the session, so the callback belongs on the same path as the state
    // change instead of chasing it a render later.
    onFinished?.({ sessionId, summary: summariseSession(results) });
  }, [onFinished, results, sessionId]);

  const advance = useCallback(() => {
    if (config === null) return;

    // Anything still in flight belongs to the spot we are leaving.
    tokenRef.current += 1;

    const last = index + 1 >= spots.length;

    if (last && config.length === null) {
      // Endless: draw the next batch from a seed derived from the session's, so
      // the whole run still replays from one number.
      const next = batch + 1;
      const chosenTemplates = templates
        .filter((entry) => config.templateSlugs.includes(entry.template.slug))
        .map((entry) => entry.template);

      setSpots(
        generateSession({
          templates: chosenTemplates,
          seed: batchSeed(sessionSeed, next),
          count: BATCH,
          registry,
        }),
      );
      setBatch(next);
      setIndex(0);
      setReveal(null);
      setStartedAt(Date.now());
      return;
    }

    if (last) {
      void finish();
      return;
    }

    setIndex((i) => i + 1);
    setReveal(null);
    setStartedAt(Date.now());
  }, [batch, config, finish, index, registry, sessionSeed, spots.length, templates]);

  const stop = useCallback(() => {
    void finish();
  }, [finish]);

  // One listener for the whole runner. Registered here rather than on the
  // buttons so the shortcuts work wherever focus happens to be — which is the
  // point of a keyboard-first drill.
  useEffect(() => {
    if (phase !== 'running') return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setHelpOpen(false);
        return;
      }
      if (!isShortcutTarget(event)) return;

      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }
      if (helpOpen) return;

      if (reveal !== null) {
        if (event.key === ' ') {
          event.preventDefault();
          advance();
        }
        return;
      }

      const digit = Number.parseInt(event.key, 10);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        const sized = choices.filter((choice) => choice.size !== undefined);
        const picked = sized[digit - 1];
        if (picked !== undefined) {
          event.preventDefault();
          void answer(picked);
        }
        return;
      }

      if (current === undefined) return;

      const match = actionForKey(event.key, legalActions(current.spot.state));
      if (match === undefined) return;

      const picked = choices.find((choice) => choice.action === match.action);
      if (picked !== undefined) {
        event.preventDefault();
        void answer(picked);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [advance, answer, choices, current, helpOpen, phase, reveal]);

  // With a preset, the caller owns the ending; the built-in summary and config
  // screen would both be wrong inside a lesson.
  if (phase === 'finished' && onFinished) {
    return null;
  }

  if (phase === 'configuring' && preset !== undefined) {
    return (
      <p className="text-sm text-ink-muted" role="status">
        Setting up your spots…
      </p>
    );
  }

  if (phase === 'configuring') {
    return (
      <div className="flex flex-col gap-4">
        {error ? <p className="text-sm text-ink">{error}</p> : null}
        <SessionConfigForm
          templates={templates.map((entry) => entry.template)}
          allowFilters={mode === 'focused'}
          onStart={(chosen) => void start(chosen)}
          busy={starting}
        />
      </div>
    );
  }

  if (finishing) {
    return (
      <p className="text-sm text-ink-muted" role="status">
        Saving the last of your answers…
      </p>
    );
  }

  if (phase === 'finished') {
    return (
      <SessionSummary
        summary={summariseSession(results)}
        studyMode={config?.studyMode ?? false}
        onRestart={() => {
          setPhase('configuring');
          setError(null);
        }}
      />
    );
  }

  if (current === undefined || chart === undefined || recommendation === null) {
    return <p className="text-sm text-ink-muted">Preparing the next spot…</p>;
  }

  const studyMode = config?.studyMode ?? false;
  const showChart = studyMode || reveal !== null;
  const planned = config?.length;

  return (
    <div className="flex flex-col gap-6">
      <ShortcutsOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-lg font-semibold">
            {studyMode ? 'Study' : 'Drill'}
          </h1>
          <span className="font-mono text-xs text-ink-muted" data-testid="progress">
            {planned == null
              ? `Spot ${results.length + (reveal ? 0 : 1)}`
              : `Spot ${index + 1} of ${planned}`}
          </span>
          {config?.timed && !studyMode && reveal === null ? (
            <SpotTimer key={startedAt} startedAt={startedAt} />
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setHelpOpen(true)}>
            Shortcuts (?)
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={stop}>
            End session
          </Button>
        </div>
      </header>

      {error ? (
        <p className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink">
          {error}
        </p>
      ) : null}

      {/* Side by side, per docs/05's first desktop advantage: the spot stays on
          screen while the feedback appears beside it. Never a modal. */}
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
        <SpotView spot={current.spot}>
          <DecisionControls
            state={current.spot.state}
            hero={current.spot.hero}
            choices={choices}
            onAnswer={(choice) => void answer(choice)}
            disabled={reveal !== null}
          />

          {reveal !== null ? (
            <Button type="button" onClick={advance}>
              Next spot (Space)
            </Button>
          ) : null}
        </SpotView>

        {showChart ? (
          <FeedbackPanel
            hand={current.spot.scenario.hand}
            chart={chart}
            chartLabel={chartLabel(chart)}
            frequencies={recommendation.frequencies}
            rationale={reveal?.rationale ?? (studyMode ? recommendation.rationale : null)}
            grade={reveal?.grade}
            answer={reveal?.answer}
            verbose={studyMode}
          />
        ) : (
          <div className="flex items-center justify-center rounded-[var(--radius)] border border-dashed border-line p-8 text-center text-sm text-ink-muted">
            The chart appears once you answer. Switch to Study mode to see it first.
          </div>
        )}
      </div>
    </div>
  );
}
