/**
 * What a villain can still have.
 *
 * Until 12c the bot's `handStrength` measured equity against **one uniformly
 * random hand** and compared the result straight to the price the pot was
 * offering. Nothing in that model knew that anybody had raised: "I beat a random
 * hand" was read as "I beat the range that just raised me". Measured over 400
 * hands against the real charts, facing a bet postflop the bots raised 41% of
 * the time and folded 14%, and somebody was all-in in 38% of hands.
 *
 * **The opponent model is the chart set.** Not a table of hands written here —
 * CLAUDE.md keeps strategy content in `packages/content`, "never hardcoded in
 * components or engine logic", and "what a cutoff opener holds" is exactly that
 * kind of content. The registry is already injected into every bot strategy, so
 * the ranges the app teaches are the ranges the bots are read as holding. When
 * the missing charts arrive — cold-calls, 3-bets, squeezes — they narrow this
 * model on the same day they close a grading hole.
 *
 * Where no chart reaches, the answer is **uniform**, and that is honest rather
 * than lazy: a big blind that checked its option really does hold any two cards,
 * and for a cold-call nobody has authored, "unknown" is the same refusal
 * `hand-review.ts` makes when it reports `uncharted` instead of grading against
 * a guess.
 *
 * This never grades anybody. It shapes what the *bot* believes, and
 * `tests/grading-isolation.test.ts` keeps `drills/` from reaching it.
 */

import { CANONICAL_HANDS } from '../cards';
import type { BettingAction, HandState } from '../game';
import { contestingSeats } from '../game';
import type { ChartRegistry, HandWeights, Position, Range } from '../ranges';
import {
  STACK_DEPTH_100BB,
  TABLE_SIZE_6MAX,
  comboCount,
  lookupChart,
  toWeights,
} from '../ranges';

import { MAX_OPEN_BLINDS } from './chart-strategy';

/**
 * Every hand, equally. The prior before anybody has told you anything, and the
 * answer wherever the charts do not reach.
 */
export const UNIFORM_RANGE: HandWeights = Object.freeze(
  Object.fromEntries(CANONICAL_HANDS.map((hand) => [hand, 1])),
) as HandWeights;

/** The first thing a seat did preflop that was not a fold, and what preceded it. */
interface Commitment {
  entry: BettingAction;
  priorRaises: readonly BettingAction[];
  priorCalls: number;
}

function commitmentOf(state: HandState, villain: Position): Commitment | undefined {
  const priorRaises: BettingAction[] = [];
  let priorCalls = 0;

  for (const entry of state.history) {
    if (entry.street !== 'preflop') break;

    if (entry.position === villain && entry.action !== 'fold') {
      // A check is not a commitment. The big blind checking its option has told
      // you nothing at all, which is a different statement from "it folds
      // everything else" and has to stay that way.
      return entry.action === 'check' ? undefined : { entry, priorRaises, priorCalls };
    }

    if (entry.action === 'raise' || entry.action === 'allin') priorRaises.push(entry);
    if (entry.action === 'call') priorCalls += 1;
  }

  return undefined;
}

/** A raise the seeded defence charts are authored against. */
function isStandardOpen(state: HandState, open: BettingAction): boolean {
  const size = open.size ?? 0;
  return size > state.bigBlind && size <= MAX_OPEN_BLINDS * state.bigBlind;
}

function rangeFor(
  registry: ChartRegistry,
  heroPosition: Position,
  actionSequence: string,
): Range | undefined {
  return lookupChart(registry, {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition,
    actionSequence,
  })?.ranges;
}

/**
 * The hands a villain can still hold, weighted by how often they play them.
 *
 * Resolved from the **first voluntary thing they did preflop**, and carried
 * forward unchanged to the flop, turn and river. Narrowing street by street
 * would take numbers nobody has authored; leaving the preflop range in place is
 * a crude approximation that is still enormously better than uniform, and it is
 * an approximation this comment can state plainly rather than bury in a
 * constant.
 *
 * Weights are the frequency of the action they actually took — a seat that
 * called an open holds the calling half of the defence chart, not the whole of
 * it, and one that three-bet holds the other half.
 */
export function continuingRange(
  state: HandState,
  villain: Position,
  registry: ChartRegistry,
): HandWeights {
  const commitment = commitmentOf(state, villain);
  if (commitment === undefined) return UNIFORM_RANGE;

  const { entry, priorRaises, priorCalls } = commitment;

  const ranges = chartRangeFor(state, villain, registry, entry, priorRaises, priorCalls);
  if (ranges === undefined) return UNIFORM_RANGE;

  const weights = toWeights(ranges, entry.action);

  // A chart that offers nothing at all for the action taken — an all-in, or a
  // size the chart never contemplated — describes some other spot. Uniform is
  // the honest answer, and it is also the only one `equityVsRange` can sample.
  return comboCount(weights) === 0 ? UNIFORM_RANGE : weights;
}

function chartRangeFor(
  state: HandState,
  villain: Position,
  registry: ChartRegistry,
  entry: BettingAction,
  priorRaises: readonly BettingAction[],
  priorCalls: number,
): Range | undefined {
  // Opened first in: nobody had put money in voluntarily, and they raised.
  if (priorRaises.length === 0 && priorCalls === 0) {
    if (entry.action !== 'raise' || !isStandardOpen(state, entry)) return undefined;
    return rangeFor(registry, villain, 'rfi');
  }

  // Defended the big blind against exactly one standard open. The same shape
  // `deriveActionSequence` recognises, from the other side of the decision.
  if (villain === 'BB' && priorRaises.length === 1 && priorCalls === 0) {
    const open = priorRaises[0]!;
    if (!isStandardOpen(state, open)) return undefined;
    return rangeFor(registry, villain, `vs_${open.position.toLowerCase()}_open`);
  }

  return undefined;
}

/**
 * The contesting opponent holding the **narrowest** range.
 *
 * A single equity number has to be measured against somebody, and the seat that
 * matters is the one most likely to have hero beaten — which is the one whose
 * range the charts have narrowed most, not the one who acted last. Falls back to
 * any contesting seat when every range is uniform, so the caller always gets an
 * opponent when there is one.
 */
export function narrowestOpponent(
  state: HandState,
  hero: Position,
  registry: ChartRegistry,
): Position | undefined {
  let narrowest: Position | undefined;
  let fewest = Number.POSITIVE_INFINITY;

  for (const seat of contestingSeats(state)) {
    if (seat.position === hero) continue;

    const combos = comboCount(continuingRange(state, seat.position, registry));
    if (combos < fewest) {
      fewest = combos;
      narrowest = seat.position;
    }
  }

  return narrowest;
}
