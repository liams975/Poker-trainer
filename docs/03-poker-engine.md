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
---

## What Phase 12a decided

The engine can play a hand of poker. Eleven modules now; `bot` is the new one.

### The seam existed. What it connects to did not.

`docs/01-architecture.md` says building the bot "becomes mostly UI work because
the decision-making already exists and is already tested". The seam is real —
`Strategy.recommend` is genuinely the same function for a drill and a bot — but
what sits behind it covers **ten spots**: RFI for five seats and big-blind
defence against five openers. `deriveActionSequence` returns `undefined` for any
postflop street, any limped pot, any 3-bet, any non-BB seat facing an open, and
any open outside 1–4bb, and `recommend` throws on all of them by design.

A bot could not complete one preflop orbit: UTG opens from a chart, and the
very next seat has no chart at all.

### The heuristic drives the bot and never grades anybody

`heuristics.ts` refused to ship a decision-making strategy in Phase 3:

> "A crude postflop strategy would be able to *grade* a user, and grading
> someone against invented postflop logic teaches wrong play."

That refusal is narrowed to its actual reason rather than reversed. What is
forbidden is **grading** against invented logic. An opponent that *plays* by
invented logic is just an opponent, and nobody is being told their play was
wrong.

Narrowing is enforced in three places rather than asserted once:

- Every heuristic recommendation carries `source: 'heuristic'` and
  `chartVersion: HEURISTIC_VERSION` — the literal string `heuristic`,
  deliberately not shaped like a chart set's dated version, so one reaching
  `drill_attempts.chart_version` is obvious in the data.
- `tests/grading-isolation.test.ts` — `drills/` cannot import `bot/` or name a
  heuristic constructor, and `gradeAnswer` takes frequencies rather than a
  strategy, so there is no argument through which one could arrive.
- `apps/web/tests/grading-strategy.test.ts` — the only two places that grade a
  user build `createChartStrategy` and nothing else.

**It does not claim to play well**, and nothing in the tests claims it does.
It plays legally, it mixes, and it responds to equity, price and stack depth.
Hand strength is equity against a *uniformly random* opponent, discounted
`equity ** opponents` for a multiway pot — a crude model chosen over a
hand-picked continuing range precisely because a range hardcoded in engine
logic would be strategy content in the wrong place, and invented numbers on top
of invented logic.

### The composite prefers the chart, and asks rather than catches

`createBotStrategy` is `chartRecommendation(...) ?? heuristic.recommend(...)`.
One expression, one direction: a chart is authored content and the heuristic is
a guess, so wherever both could answer the chart wins outright. Never blended —
a blend would make the bot play a strategy nobody wrote.

`chartRecommendation` was split out of `recommend` for this. Leaving charted
territory is the *normal* path for a bot, not the exceptional one, so a
try/catch around every decision would be exception-driven control flow for the
majority case. `recommend` keeps throwing, unchanged, for the drill path.

### Chip conservation is the exit criterion

`betting.ts` had carried two omissions since Phase 3: "side pots are not split,
and no showdown is awarded". Both are closed — `pot.ts` layers the pots and
returns the uncalled portion, `settle.ts` ranks and pays.

A side-pot bug does not crash and does not look wrong. It quietly pays the
wrong player, and the only way to see it from outside is to count:

```
sum(stacks) === startingTotal + rebought
```

Verified over 100,000 hands (`pnpm test:engine:bot`); 2,000 run in `pnpm test`.
Two rules that are silent when broken get their own tests: **odd chips go to the
first eligible seat left of the button** — which is why `Pot.eligible` arrives
in postflop action order rather than seat order — and **a folded-out pot has no
showdown**, so `HandResult.showdown` is `undefined` rather than empty.

### Dead money and uncalled bets are derived, not special-cased

Two rules that implementations usually hardcode fall out of the arithmetic:

- A folded seat's chips stay in the pot and fill **the layers they reached** —
  a seat that called 35 before folding leaves 20 in a 20-level main pot and 15
  in the side pot, not all 35 in the main pot.
- "Everyone folds to the big blind" needs no rule. The big blind is the top
  contributor and the small blind the second, so 0.5bb comes back uncalled and
  the big blind nets exactly the small blind.

### Still open

- **`playHand` runs to completion**, so a human cannot sit down yet.
  `advanceHand` / `actInHand` are exported for 12b to drive a step at a time.
- **When everyone is all-in, the board is dealt five at once** rather than
  street by street, because `applyAction` walks the streets out on its own. The
  cards are identical — same deck, same order — so a UI can slice `board` to
  reveal them one at a time.
- **A table seats exactly six.** Short-handed play is not a smaller version of
  this: `createHandState` drops the earliest positions, so four-handed is
  CO/BTN/SB/BB and heads-up has no button seat in this model. Those are real
  position rules and inventing them to make a test easier would put made-up
  poker in the engine.
