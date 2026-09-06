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

import { CANONICAL_HANDS } from '../cards';
import { equityVsHands } from '../equity';
import type { HandState, LegalAction } from '../game';
import { amountToCall, contestingSeats, currentBet, legalActions, potSize, seatAt } from '../game';
import type { Action, ActionFreq, Position } from '../ranges';
import type { Rng } from '../rng';

import { classifyBoard, potOdds, spr } from './heuristics';
import type { RationaleFactor } from './rationale';
import { factor, rationale } from './rationale';
import type { ActionRecommendation, Strategy } from './strategy';

/**
 * What the heuristic reports as its "chart version".
 *
 * Not a version. Chart sets are dated — `2026.08.25-1` — and this must never be
 * mistakable for one if it ends up in a stored row.
 */
export const HEURISTIC_VERSION = 'heuristic';

/** Frequencies below this are rounding, not strategy, and are dropped. */
const MIN_FREQ = 0.01;

export interface HeuristicOptions {
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
 * Hero's equity against **one uniformly random hand**, discounted for the
 * number of opponents still in.
 *
 * A uniform opponent is a crude model and is chosen deliberately over a
 * hand-picked "continuing range": a range hardcoded here would be strategy
 * content living in engine logic, which CLAUDE.md forbids, and it would be
 * invented numbers on top of invented logic. Sampling every combo is at least a
 * defined quantity, and `rangeCombos` already removes the cards hero and the
 * board can see.
 *
 * The multiway discount is `equity ** opponents` — the chance of beating them
 * all if their hands were independent, which they are not. It is an
 * approximation and it errs toward caution in a multiway pot, which is the
 * direction a crude bot should err.
 */
function handStrength(state: HandState, hero: Position, options: HeuristicOptions): number {
  const seat = seatAt(state, hero);
  const opponents = contestingSeats(state).length - 1;

  if (opponents <= 0) return 1;

  const { equity } = equityVsHands(seat.hole!, CANONICAL_HANDS, {
    rng: options.rng,
    trials: options.trials ?? DEFAULT_TRIALS,
    board: state.board,
  });

  return equity ** opponents;
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

  const weights = new Map<Action, number>();
  const has = (action: Action) => legal.some((option) => option.action === action);

  if (facingBet) {
    // How much better hero's equity is than the price demands. This is the
    // whole decision; everything else scales it.
    const edge = strength - requiredEquity;

    if (has('fold')) weights.set('fold', clamp(0.5 - 3 * edge) / looseness);
    if (has('call')) weights.set('call', clamp(1 - Math.abs(edge) * 2, 0.05, 1) * looseness);
    if (has('raise')) weights.set('raise', clamp(edge * 3 - 0.1) * aggression);
  } else {
    if (has('check')) weights.set('check', clamp(1 - strength, 0.1, 1));
    if (has('bet')) weights.set('bet', clamp(strength * 1.6 - 0.3) * aggression);
  }

  /**
   * All-in is aggression of last resort, and it scales with how little is left
   * behind rather than with strength alone. At an SPR of 1 a strong hand has
   * nothing to gain by betting small; at an SPR of 20 shoving is a way to be
   * called only when beaten.
   */
  if (has('allin') && stackToPot > 0) {
    weights.set('allin', clamp(strength - 0.55) * (1 / (1 + stackToPot)) * aggression);
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
