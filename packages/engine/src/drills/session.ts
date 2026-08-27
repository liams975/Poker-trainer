/**
 * A drill session: many spots, drawn across several templates.
 *
 * `generateSpots` already draws distinct spots from one template, but a quick
 * drill mixes across every published template, and it keeps its per-spot seeds
 * to itself. `drill_attempts.seed` is `not null` precisely so a historical
 * attempt can be regenerated exactly (docs/03-poker-engine.md), so a session
 * has to hand back the seed it used for each spot — a column recording a number
 * that regenerates nothing would be worse than no column.
 *
 * Session *presentation* is Phase 7's UI. What lives here is the part that is
 * poker logic: which template a spot comes from, how spots avoid repeating, and
 * how a run of grades is summarised. CLAUDE.md: never put poker logic in a
 * React component.
 */

import type { ChartRegistry } from '../ranges';
import { STACK_DEPTH_100BB, TABLE_SIZE_6MAX, lookupChart } from '../ranges';
import { mulberry32 } from '../rng';

import type { DrillScenario, DrillSpot } from './generate';
import { generateSpot } from './generate';
import type { GradeTier } from './grade';
import { GRADE_TIERS } from './grade';
import type { DrillTemplate } from './template';

export interface SessionSpot {
  /** Regenerates this exact spot through `generateSpot`. Stored per attempt. */
  seed: number;
  spot: DrillSpot;
  /** The template that produced it — `drill_attempts.template_id` needs this. */
  template: DrillTemplate;
}

export interface GenerateSessionOptions {
  templates: readonly DrillTemplate[];
  seed: number;
  count: number;
  registry: ChartRegistry;
  /**
   * Restricts the session to spots exercising these skill tags. Empty or
   * absent draws from everything, which is the ordinary case.
   *
   * This is how Phase 9 drills a weak spot, and it cannot be done by choosing
   * templates: a template is a *family*, and the opening template covers UTG,
   * CO and BTN alike. Someone whose leak is the button would be handed UTG
   * spots most of the time while the feature looked like it was working.
   */
  focusTags?: readonly string[];
}

/** Same identity `generateSpots` uses, so the no-repeat rule matches. */
function spotKey(scenario: DrillScenario): string {
  return `${scenario.heroPosition}|${scenario.actionSequence}|${scenario.hand}`;
}

export function generateSession(options: GenerateSessionOptions): readonly SessionSpot[] {
  const { templates, seed, count, registry } = options;
  const focus = new Set(options.focusTags ?? []);

  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${count}`);
  }

  // RLS already returns only published templates, but the registry is data and
  // a draft reaching here would silently drill unreleased content. Filtering is
  // one line; discovering it in production is not.
  const published = templates.filter((template) => template.published);
  if (published.length === 0) {
    throw new RangeError('a session needs at least one published template');
  }

  /**
   * Narrowing the draw pool as well as rejecting spots. A template's
   * `skillTags` is its whole family, so this is only a first pass — the real
   * filter is per-spot below — but without it a one-tag session would reject
   * most of what it drew and run out of attempts long before it ran out of
   * spots.
   */
  const usable =
    focus.size === 0
      ? published
      : published.filter((template) => template.skillTags.some((tag) => focus.has(tag)));

  if (usable.length === 0) {
    throw new RangeError(
      `no published template covers ${[...focus].join(', ')}, so the session would be empty`,
    );
  }

  const master = mulberry32(seed);
  const session: SessionSpot[] = [];
  const seen = new Set<string>();
  // Focused sessions reject spots as well as duplicates, so they need a longer
  // budget to fill from the same pool.
  const maxAttempts = count * (focus.size === 0 ? 20 : 60);

  for (let attempt = 0; session.length < count && attempt < maxAttempts; attempt++) {
    // Template first, then the spot's seed, so both are drawn from the one
    // master stream and the whole session replays from a single number.
    const template = usable[master.nextInt(usable.length)]!;
    const spotSeed = master.nextUint32();
    const spot = generateSpot({ template, seed: spotSeed, registry });

    // The tag this spot actually exercises — the chart's own, never the
    // template's list. Checked after generation because which seat hero lands
    // in is what the seed decides.
    if (focus.size > 0 && !skillTagsFor(spot.scenario, registry).some((tag) => focus.has(tag))) {
      continue;
    }

    const key = spotKey(spot.scenario);
    if (seen.has(key)) continue;
    seen.add(key);

    session.push({ seed: spotSeed, spot, template });
  }

  if (session.length < count) {
    const scope =
      focus.size === 0
        ? `templates ${usable.map((t) => `"${t.slug}"`).join(', ')}`
        : `templates ${usable.map((t) => `"${t.slug}"`).join(', ')} focused on ${[...focus].join(', ')}`;

    throw new RangeError(
      `${scope} yielded only ${session.length} distinct spots in ${maxAttempts} draws, ` +
        `short of the ${count} asked for`,
    );
  }

  return session;
}

/**
 * The skill tags to record on an attempt at this spot.
 *
 * A template's `skillTags` lists every tag its family can touch — the opening
 * template carries all five position tags. An attempt happened at exactly one
 * spot, and weak-spot detection in Phase 9 reads these, so recording the whole
 * family would smear one BTN mistake across UTG, HJ, CO and SB alike.
 *
 * The chart addressed by the scenario already carries the right tag, authored
 * alongside the range itself, so this resolves rather than derives. That also
 * means the tags satisfy `drill_attempts_skill_tags_valid` by construction:
 * they came from the same content the closed vocabulary was built from.
 */
export function skillTagsFor(
  scenario: DrillScenario,
  registry: ChartRegistry,
): readonly string[] {
  // `ChartKey` pins these to 6-max and 100bb, and v1 charts cover nothing else.
  // Checked rather than cast: a scenario carrying other values is a spot no
  // chart can answer, and it should say so here instead of missing by key.
  if (scenario.tableSize !== TABLE_SIZE_6MAX || scenario.stackDepth !== STACK_DEPTH_100BB) {
    throw new RangeError(
      `no chart covers ${scenario.tableSize}-max ${scenario.stackDepth}bb, so the attempt has no skill tag`,
    );
  }

  const chart = lookupChart(registry, {
    tableSize: TABLE_SIZE_6MAX,
    stackDepth: STACK_DEPTH_100BB,
    heroPosition: scenario.heroPosition,
    actionSequence: scenario.actionSequence,
  });

  if (chart === undefined) {
    throw new RangeError(
      `no chart covers ${scenario.heroPosition}/${scenario.actionSequence}, so the attempt has no skill tag`,
    );
  }

  return chart.skillTags;
}

/**
 * `vs_utg_open` and `vs_btn_open` are different charts but the same *decision*:
 * hero is facing a single raise and choosing a 3-bet size.
 */
function sequenceFamily(actionSequence: string): string {
  return /^vs_[a-z]+_open$/.test(actionSequence) ? 'vs_open' : actionSequence;
}

/**
 * The raise sizes a drill offers hero.
 *
 * These must not come from hero's own chart. Each seeded chart raises to
 * exactly one size, so a control built from it would hand the user the answer
 * before they chose — and the size term in `gradeAnswer` would be unreachable.
 *
 * Drawing from every chart in the same *family* fixes both. The opening family
 * offers {2.5, 3} because SB opens larger than the rest; the defence family
 * offers {10, 11} because the 3-bet is smaller against the small blind's wider,
 * larger open. Which one applies here is exactly what is being tested, and the
 * option list is identical whichever seat hero is in, so it reveals nothing.
 *
 * That the correct size is always among the options is not luck — the options
 * are the union of what the family's charts use.
 */
export function raiseSizeOptions(
  scenario: DrillScenario,
  registry: ChartRegistry,
): readonly number[] {
  const family = sequenceFamily(scenario.actionSequence);
  const sizes = new Set<number>();

  for (const chart of registry.values()) {
    if (sequenceFamily(chart.actionSequence) !== family) continue;

    for (const entries of Object.values(chart.ranges)) {
      for (const entry of entries) {
        if ((entry.action === 'raise' || entry.action === 'bet') && entry.size !== undefined) {
          sizes.add(entry.size);
        }
      }
    }
  }

  return [...sizes].sort((a, b) => a - b);
}

export interface AttemptResult {
  tier: GradeTier;
  evLoss: number;
}

export interface SessionSummary {
  spots: number;
  /** Every tier, zero-filled — an absent tier is a fact worth showing. */
  byTier: Readonly<Record<GradeTier, number>>;
  /** In big blinds, four decimals, matching `drill_attempts.ev_loss`. */
  totalEvLoss: number;
  avgEvLoss: number;
}

/** Matches the `numeric(8,4)` the attempts are stored in. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Deliberately no single accuracy percentage.
 *
 * docs/03-poker-engine.md: "Score by EV loss, not accuracy percentage." Two of
 * the four tiers are defensible answers rather than partial credit, so any
 * "78% correct" would be reasserting the binary framing the tiers exist to
 * reject — and it would count a 50/50 hand answered either way as a miss half
 * the time.
 */
export function summariseSession(results: readonly AttemptResult[]): SessionSummary {
  const byTier = Object.fromEntries(GRADE_TIERS.map((tier) => [tier, 0])) as Record<
    GradeTier,
    number
  >;

  let totalEvLoss = 0;
  for (const result of results) {
    byTier[result.tier] += 1;
    totalEvLoss += result.evLoss;
  }

  return {
    spots: results.length,
    byTier,
    totalEvLoss: round4(totalEvLoss),
    // An abandoned session has nothing to average, and 0 reads correctly next
    // to "0 spots" — NaN would reach the UI as "NaN bb lost".
    avgEvLoss: results.length === 0 ? 0 : round4(totalEvLoss / results.length),
  };
}
