/**
 * The bot's brain.
 *
 * `heuristics.ts` refused to ship one of these in Phase 3, and its reason is
 * exact and still correct:
 *
 *   "Deliberately no `HeuristicStrategy` ships alongside them. A crude postflop
 *    strategy would be able to *grade* a user, and grading someone against
 *    invented postflop logic teaches wrong play."
 *
 * Phase 12a narrows that refusal to its actual reason rather than reversing it.
 * What is forbidden is **grading** against invented logic. An opponent that
 * *plays* by invented logic is just an opponent — every poker bot ever written
 * is invented logic — and nobody is being told their play was wrong.
 *
 * Two things enforce the narrowing rather than merely intending it:
 *
 *   - Every recommendation carries `source: 'heuristic'` and
 *     `chartVersion: HEURISTIC_VERSION`, which is deliberately not shaped like
 *     a chart set's dated version. A heuristic recommendation reaching
 *     `drill_attempts.chart_version` would be obvious in the data rather than
 *     plausible.
 *   - `apps/web/tests/grading-strategy.test.ts` asserts the two places that
 *     grade a user build the *chart* strategy and never this one.
 *
 * **This does not claim to play well.** It claims to play legally, to mix, and
 * to respond to equity, price and stack depth. That is enough for an opponent
 * and nowhere near enough to grade against.
 */

import type { Card } from '../cards';
import { equityVsRange, rangeCombos } from '../equity';
import type { HandWeighting } from '../equity';
import type { HandState, LegalAction } from '../game';
import { amountToCall, contestingSeats, currentBet, legalActions, potSize, seatAt } from '../game';
import type { Action, ActionFreq, ChartRegistry, Position } from '../ranges';
import type { Rng } from '../rng';

import { classifyBoard, potOdds, spr } from './heuristics';
import { UNIFORM_RANGE, continuingRange, narrowestOpponent } from './opponent-range';
import type { RationaleFactor } from './rationale';
import { factor, rationale } from './rationale';
import type { ActionRecommendation, Strategy } from './strategy';

/**
 * What the heuristic reports as its "chart version".
 *
 * Not a version. Chart sets are dated — `2026.08.25-1` — and this must never be
 * mistakable for one if it ends up in a stored row.
 */
export const HEURISTIC_VERSION = 'heuristic.2';

/** Frequencies below this are rounding, not strategy, and are dropped. */
const MIN_FREQ = 0.01;

export interface HeuristicOptions {
  /**
   * The charts, which are also the opponent model — see `opponent-range.ts`.
   *
   * **Required, not optional.** An optional registry would mean the bot in the
   * tests is a different bot from the one people play against, and the whole of
   * 12c is the discovery that nobody had checked which one they were measuring.
   * An empty registry is a legitimate value; it simply narrows nobody.
   */
  registry: ChartRegistry;
  rng: Rng;
  /**
   * Monte Carlo runouts per decision. The default is a compromise: high enough
   * that the bot is not reacting to noise, low enough that a few thousand
   * simulated hands finish inside a test run. Callers that simulate in bulk
   * turn it down; nothing about the strategy's shape changes when they do.
   */
  trials?: number;
  /** Scales how often it bets and raises. 1 is neutral. */
  aggression?: number;
  /** Scales how willingly it continues. 1 is neutral. */
  looseness?: number;
}

const DEFAULT_TRIALS = 200;

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

/** Two decimals, matching the money column everything else rounds to. */
function chips(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Hero's equity against **the range the dangerous opponent can still hold**,
 * discounted for the number of opponents still in.
 *
 * Until 12c this measured equity against one uniformly random hand, and `weigh`
 * compared that straight to the price the pot was offering. Nothing in it knew
 * that anybody had raised, so "I beat a random hand" was read as "I beat the
 * range that just raised me" — and top pair on the flop, which is 80% against a
 * random hand and much less against an opening range, raised into a bet 41% of
 * the time. Somebody was all-in in 38% of hands.
 *
 * The range comes from `opponent-range.ts`, which is the chart registry rather
 * than a table written here: CLAUDE.md keeps strategy content in
 * `packages/content`. Where no chart reaches it is uniform, which is what this
 * always was — the change is that where a chart *does* reach, the bot now uses
 * it.
 *
 * The multiway discount is `equity ** opponents` — the chance of beating them
 * all if their hands were independent, which they are not. It is an
 * approximation and it errs toward caution in a multiway pot, which is the
 * direction a crude bot should err.
 */
function handStrength(state: HandState, hero: Position, options: HeuristicOptions): number {
  const seat = seatAt(state, hero);
  const opponents = opponentCount(state, hero);

  if (opponents <= 0) return 1;

  const villain = narrowestOpponent(state, hero, options.registry);
  const weighting =
    villain === undefined ? UNIFORM_RANGE : continuingRange(state, villain, options.registry);

  const { equity } = equityVsRange(seat.hole!, available(weighting, [...seat.hole!, ...state.board]), {
    rng: options.rng,
    trials: options.trials ?? DEFAULT_TRIALS,
    board: state.board,
  });

  return equity ** opponents;
}

/**
 * How many opponents hero actually has to beat.
 *
 * Postflop this is every seat still contesting: they have all seen the same
 * board and chosen to still be here.
 *
 * **Preflop it is only the seats that have put money in voluntarily**, floored
 * at one, and that distinction is worth stating because getting it wrong is
 * what made the first draft of 12c unplayably tight. Facing a lone cutoff open
 * from the button, `contestingSeats` counts five opponents — the raiser, the two
 * blinds, and seats that have not acted at all — and `equity ** 5` folds
 * everything, forever. A human in that seat is facing *one* raiser and prices
 * the seats behind by folding to them when they wake up, which is what the pot
 * odds on the next decision already do.
 */
function opponentCount(state: HandState, hero: Position): number {
  const contesting = contestingSeats(state).filter((seat) => seat.position !== hero);

  if (state.street !== 'preflop') return contesting.length;

  const committed = contesting.filter((seat) =>
    state.history.some(
      (entry) =>
        entry.street === 'preflop' &&
        entry.position === seat.position &&
        (entry.action === 'call' || entry.action === 'raise' || entry.action === 'allin'),
    ),
  );

  return contesting.length === 0 ? 0 : Math.max(1, committed.length);
}

/**
 * The weighting, or uniform when the visible cards have blocked all of it away.
 *
 * A narrow chart range can be emptied by the board — hero holding two of the
 * three hands a tight opener raises, say — and `equityVsRange` refuses to sample
 * an empty range rather than returning a fabricated number. Falling back to
 * uniform is the same answer this function gave for every spot before 12c, and
 * it is reached now only where the model genuinely has nothing left to say.
 */
function available(weighting: HandWeighting, dead: readonly Card[]): HandWeighting {
  const hands = Object.keys(weighting).filter((hand) => (weighting[hand] ?? 0) > 0);

  return rangeCombos(hands, dead).length === 0 ? UNIFORM_RANGE : weighting;
}

/**
 * What to raise or bet to.
 *
 * Pot-fraction sizing, clamped into what is actually legal. The fractions are
 * conventional rather than derived — this is a bot, not a solver, and the
 * comment saying so is the honest version of a tuned constant.
 */
function sizeFor(state: HandState, option: LegalAction, strength: number): number {
  const pot = potSize(state);
  const bet = currentBet(state);

  const target =
    option.action === 'bet'
      ? pot * (0.4 + 0.35 * strength)
      : // A raise has to clear what is already out there before the pot
        // fraction means anything.
        bet * 2 + pot * 0.3;

  const low = option.minTo ?? state.bigBlind;
  const high = option.maxTo ?? target;

  return chips(clamp(target, low, high));
}

/**
 * The tuning. Every number here was **fitted against measured table
 * statistics**, not chosen because it looked reasonable — which is what
 * happened to the set these replaced, and `tests/bot-behaviour.test.ts` is what
 * stops it happening again.
 *
 * The shape matters more than the values, and three things about it are
 * deliberate:
 *
 *   - `call` **rises** with edge. The old weight was `1 - 2|edge|`, a tent
 *     peaking at a marginal call and collapsing to its 0.05 floor for anything
 *     strong — so a hand that was well ahead could not call, only raise. Both
 *     seats did that to each other and the stacks went in by the turn.
 *   - `raise` needs a real edge, not merely a positive one, and is damped by the
 *     aggression already on the street. A fourth re-raise should be harder than
 *     the first; before, each one was as easy as the last.
 *   - `allin` needs a large edge *and* a low SPR. It used to need only
 *     `strength > 0.55`, scaled by `1/(1 + spr)` — small at 30bb deep but never
 *     zero, and never-zero across every decision of a session is how 38% of
 *     hands ended with somebody all-in.
 */
const TUNING = {
  /** Facing a bet: fold weight is `FOLD_BASE - FOLD_EDGE * edge`. */
  FOLD_BASE: 0.8,
  FOLD_EDGE: 2,
  /** Facing a bet: call weight is `CALL_BASE + CALL_EDGE * edge`. */
  CALL_BASE: 0.1,
  CALL_EDGE: 1.5,
  /** Facing a bet: raise needs `edge` past RAISE_GATE, then scales by RAISE_GAIN. */
  RAISE_GATE: 0.27,
  RAISE_GAIN: 1.4,
  /** Unbet: check weight is `1 - strength`, floored, and bet is the mirror. */
  BET_GATE: 0.34,
  BET_GAIN: 1.15,
  /** All-in needs this much edge and no more than this much stack behind. */
  ALLIN_GATE: 0.34,
  ALLIN_SPR: 3,
  ALLIN_GAIN: 1.2,
} as const;

/** Raw, unnormalised weight per legal action. */
function weigh(
  state: HandState,
  hero: Position,
  strength: number,
  legal: readonly LegalAction[],
  options: HeuristicOptions,
): Map<Action, number> {
  const aggression = options.aggression ?? 1;
  const looseness = options.looseness ?? 1;

  const { requiredEquity } = potOdds(state, hero);
  const facingBet = amountToCall(state, hero) > 0;
  const stackToPot = spr(state, hero);

  // How much better hero's equity is than the price demands. This is the whole
  // decision; everything else scales it. With nothing to call the price is zero,
  // so edge is just strength.
  const edge = strength - requiredEquity;

  /**
   * Aggression already on this street, so a re-raise is harder than a raise.
   *
   * Actual raises, not history length — the same count and the same reasoning as
   * `chart-strategy.ts`'s rationale, which has needed it since Phase 6.
   */
  const priorRaises = state.history.filter(
    (entry) =>
      entry.street === state.street && (entry.action === 'raise' || entry.action === 'allin'),
  ).length;

  const weights = new Map<Action, number>();
  const has = (action: Action) => legal.some((option) => option.action === action);

  if (facingBet) {
    if (has('fold')) {
      weights.set('fold', clamp(TUNING.FOLD_BASE - TUNING.FOLD_EDGE * edge) / looseness);
    }
    if (has('call')) {
      weights.set('call', clamp(TUNING.CALL_BASE + TUNING.CALL_EDGE * edge, 0, 1) * looseness);
    }
    if (has('raise')) {
      weights.set(
        'raise',
        (clamp(edge - TUNING.RAISE_GATE) * TUNING.RAISE_GAIN * aggression) / (1 + priorRaises),
      );
    }
  } else {
    if (has('check')) weights.set('check', clamp(1 - strength, 0.1, 1));
    if (has('bet')) {
      weights.set(
        'bet',
        (clamp(strength * TUNING.BET_GAIN - TUNING.BET_GATE) * aggression) / (1 + priorRaises),
      );
    }
  }

  /**
   * All-in is aggression of last resort. It needs both a hand that is genuinely
   * ahead of the price and a stack short enough that shoving is the bet rather
   * than a way to be called only when beaten.
   */
  if (has('allin') && stackToPot > 0 && stackToPot <= TUNING.ALLIN_SPR) {
    weights.set(
      'allin',
      clamp(edge - TUNING.ALLIN_GATE) * TUNING.ALLIN_GAIN * aggression * (1 / (1 + stackToPot)),
    );
  }

  return weights;
}

export function createHeuristicStrategy(options: HeuristicOptions): Strategy {
  return {
    recommend(state: HandState, hero: Position): ActionRecommendation {
      if (state.toAct !== hero) {
        throw new RangeError(
          `it is ${state.toAct ?? 'nobody'}'s turn, not ${hero}'s — nothing to recommend`,
        );
      }

      const seat = seatAt(state, hero);
      if (seat.hole === undefined) {
        throw new RangeError(`${hero} has no cards, so there is nothing to recommend`);
      }

      const legal = legalActions(state);
      if (legal.length === 0) {
        throw new RangeError(`${hero} has no legal action to take`);
      }

      const strength = handStrength(state, hero, options);
      const weights = weigh(state, hero, strength, legal, options);

      // Only legal actions ever get here, because `weigh` only ever asks about
      // ones `legalActions` offered. Normalising over the legal set is what
      // makes an illegal recommendation unrepresentable rather than unlikely.
      const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);

      const frequencies: ActionFreq[] = [];

      if (total <= 0) {
        // Every weight collapsed to zero. Something has to be returned, and the
        // passive legal action is the one that cannot be a blunder.
        const fallback = legal.find((option) => option.action === 'check') ?? legal[0]!;
        frequencies.push({ action: fallback.action, freq: 1 });
      } else {
        for (const option of legal) {
          const weight = weights.get(option.action);
          if (weight === undefined) continue;

          const freq = weight / total;
          if (freq < MIN_FREQ) continue;

          frequencies.push({
            action: option.action,
            ...(option.action === 'bet' || option.action === 'raise'
              ? { size: sizeFor(state, option, strength) }
              : {}),
            freq,
          });
        }
      }

      // Dropping the sub-1% tail leaves the rest short of 1.
      const kept = frequencies.reduce((sum, entry) => sum + entry.freq, 0);
      for (const entry of frequencies) entry.freq = entry.freq / kept;

      const best = frequencies.reduce((top, entry) => (entry.freq > top.freq ? entry : top));

      return {
        frequencies,
        primary: best.action,
        ...(best.size !== undefined ? { primarySize: best.size } : {}),
        rationale: buildRationale(state, hero, strength),
        source: 'heuristic',
        chartVersion: HEURISTIC_VERSION,
      };
    },
  };
}

/**
 * Structured, per docs/03: "Rationale must be structured data, not a string."
 *
 * 12b renders *why the bot did that* in post-hand review from this, without the
 * engine knowing anything about presentation. The kinds used here — `pot_odds`,
 * `spr`, `board_texture` — were already in `FACTOR_KINDS` from Phase 3, which
 * anticipated exactly this consumer.
 */
function buildRationale(state: HandState, hero: Position, strength: number): ReturnType<typeof rationale> {
  const factors: RationaleFactor[] = [
    factor('hand_class', 'high', { equity: Math.round(strength * 100) / 100 }),
    factor('pot_odds', 'medium', {
      toCall: potOdds(state, hero).toCall,
      needs: Math.round(potOdds(state, hero).requiredEquity * 100) / 100,
    }),
    factor('spr', 'low', { spr: Math.round(spr(state, hero) * 10) / 10 }),
  ];

  if (state.board.length >= 3) {
    const texture = classifyBoard(state.board);
    factors.push(
      factor('board_texture', 'medium', {
        paired: texture.paired ? 'yes' : 'no',
        suits: texture.monotone ? 'monotone' : texture.twoTone ? 'two-tone' : 'rainbow',
      }),
    );
  }

  return rationale(factors);
}
