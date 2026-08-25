# 03 — Poker Engine

`packages/engine`. Pure TypeScript. No React, no DOM, no network, no env vars,
no Node built-ins. It must run unchanged in a React Native JS runtime in v2.

## Module map

```
engine/
  rng/          Seeded PRNG. Everything random goes through here.
  cards/        Card, Rank, Suit, Deck, notation, canonical 169 hands
  evaluator/    7-card hand ranking (naive reference + fast impl)
  equity/       Monte Carlo equity: hand-vs-hand, hand-vs-range
  ranges/       Range type, algebra, serialization, chart lookup
  game/         HandState machine: streets, seats, pot, betting, legal actions
  strategy/     Strategy interface, ChartStrategy, postflop heuristics
  drills/       Scenario generation, grading, EV-loss estimation
```

Dependency direction is strictly downward. `drills` may import `strategy`;
`strategy` may not import `drills`.

## Determinism

Every source of randomness takes an injected seeded RNG. No bare
`Math.random()` anywhere in the package — enforce with an ESLint rule.

This buys you three things: reproducible drills (a user can share or replay a
spot), stable tests, and the ability to regenerate a historical attempt
exactly from its stored seed. Store `seed` on every `drill_attempt`.

## The evaluator, and how to trust it

Hand evaluation is where subtle bugs hide and where a wrong answer destroys
credibility. The strategy:

1. Write a **naive reference evaluator** — enumerate all 21 five-card subsets
   of the seven cards, rank each by obvious rules, take the max. Slow,
   readable, obviously correct.
2. Write a **fast evaluator** — bitwise/lookup based.
3. **Property-test the fast one against the naive one** on millions of random
   inputs. Any disagreement is a bug in the fast one.

Keep the naive evaluator in the repo forever as the oracle. This pattern
turns "is my evaluator right?" from a matter of faith into a test.

Additional invariants worth asserting: evaluation is order-independent
(shuffling the seven cards doesn't change the result); ranking is a total
order; known hand comparisons hold (a wheel straight beats trips, a
straight flush beats quads).

## Range representation

A range maps each of the 169 canonical hands to a frequency distribution over
actions. Frequencies sum to 1.0.

```ts
type ActionFreq = { action: Action; size?: number; freq: number };
type Range = Record<HandNotation, ActionFreq[]>;
```

Mixed strategies are the normal case, not an edge case. `AJo` from the cutoff
might be 60% open / 40% fold. **A UI or grading system that assumes one right
answer per hand is wrong.**

Chart addressing:

```ts
type ChartKey = {
  tableSize: 6;
  stackDepth: 100;
  heroPosition: Position;      // UTG | HJ | CO | BTN | SB | BB
  actionSequence: string;      // "rfi" | "vs_utg_open" | "bb_vs_btn_open" | ...
};
```

Keep `tableSize` and `stackDepth` in the key even though v1 hardcodes them.
Widening this later touches every call site.

## The Strategy interface — the v2 seam

```ts
interface Strategy {
  recommend(state: HandState, hero: Seat): ActionRecommendation;
}

interface ActionRecommendation {
  frequencies: ActionFreq[];   // the full mixed strategy
  primary: Action;             // highest-frequency action
  rationale: Rationale;        // structured, not a prose string
  source: 'chart' | 'heuristic';
  chartVersion: string;
}
```

A drill calls `recommend()` and compares the user's answer to the
distribution. A v2 bot calls `recommend()` and samples from the distribution.
Same function, two consumers. Building the bot in v2 becomes mostly UI work
because the decision-making already exists and is already tested.

**`Rationale` must be structured data, not a string.** Something like
`{ factors: [{ kind: 'position', weight: 'high', detail: ... }, ...] }`.
Structured rationale lets the UI render it as chips, highlights, or verbose
prose depending on Study vs Drill mode — without engine changes. Prose strings
lock you into one presentation and can't be styled or filtered.

## Grading — the part naive implementations get wrong

Because ranges are mixed, grading is **not** binary. Use tiers:

| Tier | Condition | Feedback tone |
|---|---|---|
| **Optimal** | User's action is the highest-frequency action | Confirm |
| **Acceptable** | Action has freq ≥ 0.15 but isn't primary | "Also fine — here's the mix" |
| **Inaccurate** | Action has freq > 0 but < 0.15 | Explain when it *is* right |
| **Blunder** | Action has freq = 0 | Explain why it never works |

Two design consequences:

- **Always show the full distribution after answering.** Teaching someone that
  `AJo` is "a fold" when it's 40% open actively makes them worse. Showing the
  mix teaches the real concept.
- **Score by EV loss, not accuracy percentage.** A blunder in a big pot should
  cost more than a marginal frequency error. For preflop chart spots, a
  reasonable proxy is the frequency-weighted distance from the primary
  action; refine when postflop lands.

Track EV loss on every attempt. It's the metric that makes "am I improving?"
answerable, and it's far more honest than a correct/incorrect ratio.

## Drill scenario generation

A `DrillTemplate` describes a family of spots: position constraints, action
sequence, hand-sampling weights. Generation takes a template plus a seed and
produces a concrete spot.

**Sample hands non-uniformly.** Uniform sampling over 169 hands wastes the
user's time on trivial folds (`72o` from UTG) and rarely surfaces the
genuinely instructive marginal spots. Weight sampling toward hands near
decision boundaries — the hands with mixed frequencies are exactly the ones
worth drilling. This one choice does more for learning velocity than any
amount of UI polish.

Reserve some uniform sampling so the user still sees the full distribution of
real spots and doesn't learn a distorted prior.

## Test plan by module

| Module | Approach |
|---|---|
| `rng` | Same seed → same sequence. Distribution sanity. |
| `cards` | Round-trip parse/serialize. Exactly 169 canonical hands. Combo counts: 6 for pairs, 4 suited, 12 offsuit. |
| `evaluator` | Property-test fast vs naive on 1M+ random hands. Order independence. Known matchups. |
| `equity` | Known benchmarks within tolerance. Symmetry: equity(A,B) + equity(B,A) + ties = 1. Determinism under seed. |
| `ranges` | Schema validation on all content. Frequencies sum to 1.0. Algebra laws (union/intersect associativity). |
| `game` | Legal-action correctness at each state. Pot math. Invalid transitions rejected. |
| `strategy` | Every chart key resolves. Recommendations well-formed. Rationale non-empty. |
| `drills` | Reproducibility under seed. Grading tier boundaries, especially the 0.15 threshold and freq=0 blunder case. |

Aim for high coverage in `evaluator`, `ranges`, and `drills` specifically —
those three are where a bug silently teaches someone the wrong thing.