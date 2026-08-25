/**
 * Turning a template plus a seed into a concrete spot.
 *
 * The reproducibility contract is the point. docs/03-poker-engine.md: a seed
 * buys replayable drills, shareable spots, stable tests, and "the ability to
 * regenerate a historical attempt exactly from its stored seed".
 *
 * There are deliberately two independent routes back to the same spot. From the
 * seed and the template, `generateSpot` rebuilds it. From the stored
 * `DrillScenario` alone — no seed, no template, no chart registry —
 * `rebuildSpot` rebuilds it. Both construct the `HandState` by replaying real
 * `applyAction` calls, never by hand-assembling state, and a test pins them
 * together so they cannot drift.
 */

import type { Combo, HandNotation } from '../cards';
import { combosOf, formatCard, handNotationOf, parseCard } from '../cards';
import type { HandState } from '../game';
import { applyAction, createHandState } from '../game';
import type { ChartRegistry, Position } from '../ranges';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, chartKeyId, isPosition, lookupChart } from '../ranges';
import { mulberry32 } from '../rng';
import { deriveActionSequence } from '../strategy';

import { sampleHand, samplingWeights } from './sampling';
import type { DrillTemplate } from './template';

/**
 * Everything needed to reconstruct a spot, and nothing else. Stored as
 * `drill_attempts.scenario`, which `docs/04-data-model.md` warns will be the
 * biggest table in the schema — hence a descriptor rather than a serialised
 * `HandState`, which would also bake today's state shape into stored history.
 */
export interface DrillScenario {
  templateSlug: string;
  heroPosition: Position;
  actionSequence: string;
  hand: HandNotation;
  /** Hero's two cards, formatted — `['As', 'Ks']`. */
  hole: readonly [string, string];
  /** The size the opener raised to. Absent for an unopened pot. */
  openSize?: number;
  tableSize: number;
  stackDepth: number;
}

export interface DrillSpot {
  scenario: DrillScenario;
  state: HandState;
  hero: Position;
}

export interface GenerateOptions {
  template: DrillTemplate;
  seed: number;
  registry: ChartRegistry;
}

/** `vs_btn_open` -> `BTN`. Undefined for an unopened pot. */
function openerOf(actionSequence: string): Position | undefined {
  const match = /^vs_([a-z]+)_open$/.exec(actionSequence);
  if (match === null) return undefined;

  const position = match[1]!.toUpperCase();
  if (!isPosition(position)) {
    throw new RangeError(`"${actionSequence}" names an unknown position`);
  }
  return position;
}

function comboFrom(hole: readonly [string, string]): Combo {
  const first = parseCard(hole[0]);
  const second = parseCard(hole[1]);
  if (first === second) {
    throw new RangeError(`a hand needs two distinct cards, got ${hole[0]} twice`);
  }
  return [first, second];
}

/**
 * Replays the betting that produces the spot. Shared by both routes, so a
 * generated state and a rebuilt one are constructed by the same code.
 */
function buildState(scenario: DrillScenario): HandState {
  const hole = comboFrom(scenario.hole);

  if (handNotationOf(hole[0], hole[1]) !== scenario.hand) {
    throw new RangeError(
      `scenario says ${scenario.hand} but holds ${handNotationOf(hole[0], hole[1])}`,
    );
  }

  const opener = openerOf(scenario.actionSequence);
  if (opener !== undefined && scenario.openSize === undefined) {
    throw new RangeError(`${scenario.actionSequence} needs an open size`);
  }

  let state = createHandState({
    tableSize: scenario.tableSize,
    stackDepth: scenario.stackDepth,
    hole: { [scenario.heroPosition]: hole },
  });

  let guard = 0;
  while (state.toAct !== undefined && state.toAct !== scenario.heroPosition) {
    state =
      state.toAct === opener
        ? applyAction(state, 'raise', scenario.openSize!)
        : applyAction(state, 'fold');

    if (++guard > 12) throw new RangeError('the scenario does not reach hero');
  }

  if (state.toAct !== scenario.heroPosition) {
    throw new RangeError(
      `${scenario.heroPosition} never gets to act in ${scenario.actionSequence}`,
    );
  }

  // A scenario is a stored descriptor that Phase 4 lets the client write, so it
  // must not be trusted to describe itself honestly. Without this check a
  // contradictory one replays into a plausible-but-wrong state: hero UTG
  // labelled `vs_bb_open` builds an unopened pot, and an unrecognised sequence
  // like `3bet_pot` falls through `openerOf` and does the same — either way the
  // answer gets graded against a chart for a different spot.
  const derived = deriveActionSequence(state, scenario.heroPosition);
  if (derived !== scenario.actionSequence) {
    throw new RangeError(
      `scenario claims ${scenario.actionSequence}, but the replay is ${derived ?? 'a spot no chart family covers'}`,
    );
  }

  return state;
}

/** Reconstructs a spot from its stored descriptor alone. */
export function rebuildSpot(scenario: DrillScenario): DrillSpot {
  return { scenario, state: buildState(scenario), hero: scenario.heroPosition };
}

export function generateSpot(options: GenerateOptions): DrillSpot {
  const { template, seed, registry } = options;
  const rng = mulberry32(seed);

  const hero = template.positions[rng.nextInt(template.positions.length)]!;

  let actionSequence = 'rfi';
  if (template.spot === 'vs_open') {
    const openers = template.openers ?? [];
    if (openers.length === 0) {
      throw new RangeError(`template "${template.slug}" is vs_open but names no openers`);
    }
    actionSequence = `vs_${openers[rng.nextInt(openers.length)]!.toLowerCase()}_open`;
  }

  const key = {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition: hero,
    actionSequence,
  } as const;

  const chart = lookupChart(registry, key);
  if (chart === undefined) {
    throw new RangeError(
      `template "${template.slug}" needs a chart for ${chartKeyId(key)}, which is not seeded`,
    );
  }

  // Weighted by the chart's own mixedness, so drilling concentrates on the
  // hands that actually teach something.
  const hand = sampleHand(rng, samplingWeights(chart.ranges, template.sampling ?? {}));
  const combos = combosOf(hand);
  const combo = combos[rng.nextInt(combos.length)]!;

  const scenario: DrillScenario = {
    templateSlug: template.slug,
    heroPosition: hero,
    actionSequence,
    hand,
    hole: [formatCard(combo[0]), formatCard(combo[1])],
    ...(template.spot === 'vs_open' ? { openSize: template.openSize! } : {}),
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
  };

  return { scenario, state: buildState(scenario), hero };
}

/**
 * A reproducible run of distinct spots. Session *state* belongs to Phase 7; this
 * is only the sequence, so that the no-repeat rule and the per-spot seed
 * derivation do not end up invented in the UI layer.
 */
export function generateSpots(options: GenerateOptions & { count: number }): readonly DrillSpot[] {
  const { count } = options;

  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${count}`);
  }

  const master = mulberry32(options.seed);
  const spots: DrillSpot[] = [];
  const seen = new Set<string>();
  const maxAttempts = count * 20;

  for (let attempt = 0; spots.length < count && attempt < maxAttempts; attempt++) {
    const spot = generateSpot({ ...options, seed: master.nextUint32() });
    const key = `${spot.scenario.heroPosition}|${spot.scenario.actionSequence}|${spot.scenario.hand}`;

    if (seen.has(key)) continue;
    seen.add(key);
    spots.push(spot);
  }

  if (spots.length < count) {
    // Usually an over-ambitious `count` rather than a broken template: a
    // single-position rfi template tops out near the number of hands its
    // sampling actually reaches, which is well above any session length.
    throw new RangeError(
      `template "${options.template.slug}" yielded only ${spots.length} distinct spots in ${maxAttempts} draws, short of the ${count} asked for`,
    );
  }

  return spots;
}
