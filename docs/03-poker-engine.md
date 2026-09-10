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
  `chartVersion: HEURISTIC_VERSION` — `heuristic`, optionally with a bump
  (`heuristic.2` since 12c), deliberately not shaped like a chart set's dated
  version, so one reaching `drill_attempts.chart_version` is obvious in the
  data. It bumps when the bot's decisions change, because
  `bot_hands.heuristic_version` is what keeps an old hand replayable by the
  engine that played it.
- `tests/grading-isolation.test.ts` — `drills/` cannot import `bot/` or name a
  heuristic constructor, and `gradeAnswer` takes frequencies rather than a
  strategy, so there is no argument through which one could arrive.
- `apps/web/tests/grading-strategy.test.ts` — the only two places that grade a
  user build `createChartStrategy` and nothing else.

**It does not claim to play well.** It plays legally, it mixes, and it responds
to equity, price and stack depth. What 12c added is that it now also responds to
*what the other players did*, and that the claim is finally measured.

#### The opponent model is the chart set

Until 12c hand strength was equity against a **uniformly random** opponent, and
`weigh` compared that straight to the price the pot demanded. Nothing in the
model knew that anybody had raised, so "I beat a random hand" was read as "I beat
the range that just raised me". A uniform villain had been chosen deliberately
over a hardcoded continuing range — a range written in engine logic is strategy
content in the wrong place — and the reasoning was right about the constraint
and wrong about the conclusion. The ranges were already there, injected, in
`ChartRegistry`.

`strategy/opponent-range.ts` resolves a villain's range from **what they did
preflop**, using the charts the app already teaches: a seat that opened holds
that seat's RFI range, a big blind that defended holds the defence chart, and
the frequency is the one the chart gives — a hand opened 50% of the time is
sampled half as often, which is what `equityVsRange` exists for. Where no chart
reaches it is uniform, and that is honest twice over: a big blind that checked
its option really does hold any two cards, and for the cold-call and 3-bet spots
nobody has authored, "unknown" is the same refusal `hand-review.ts` makes when it
reports `uncharted` rather than grading against a guess. The preflop range
carries forward unchanged to later streets; narrowing per street would take
numbers nobody has written.

Every missing chart therefore costs twice — a grading hole *and* a blind spot in
the opponent model — which is the strongest argument yet for authoring them.

#### The behaviour is a test

Legality was never the problem. 100,000 hands conserved chips to eight decimals
while the table played like nothing that has happened in a cardroom: facing a bet
postflop the bots raised **41%** of the time and folded 14%, somebody was all-in
in **38%** of hands, and the mean pot was **208bb**.

`packages/content/tests/bot-behaviour.test.ts` bands those statistics, at the
production trial count and against the real charts. It lives in `content` for
the reason `strategy.test.ts` does — the dependency runs content → engine — and
the bands are a product spec ("an opponent worth playing"), not solver output.
The constants in `weigh` were **fitted against it**; the ones they replaced were
chosen because they looked reasonable, which is a thing no test could have
caught and no reader could have seen.

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
sum(stacks) === startingTotal + rebought - cashedOut
sum(stacks) === players.length * stackDepth      // every hand, exactly
sum(net)    === 0                                // one seat's win is another's loss
```

**Three, since 12c.** 12b tracked only the chips a rebuy *added*, which balanced
its books while the table quietly inflated: `finishTableHand` topped a busted
seat back up and never took a chip off a winner, so 400 hands left 10,400bb on a
table that opened with 600 — and `chartRecommendation` went on grading against
100bb charts the whole way. Every seat now squares back to `stackDepth` after
each hand, so the last two hold exactly and what the stack used to say about a
sitting moves to `TablePlayer.net`, which says it better.

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

- ~~**`playHand` runs to completion**, so a human cannot sit down yet.~~
  Closed in 12b by `stepHand`; see below.
- **When everyone is all-in, the board is dealt five at once** rather than
  street by street, because `applyAction` walks the streets out on its own. The
  cards are identical — same deck, same order — so a UI can slice `board` to
  reveal them one at a time.
- **A table seats exactly six.** Short-handed play is not a smaller version of
  this: `createHandState` drops the earliest positions, so four-handed is
  CO/BTN/SB/BB and heads-up has no button seat in this model. Those are real
  position rules and inventing them to make a test easier would put made-up
  poker in the engine.

---

## What Phase 12b decided

The engine half of 12b is small, because 12a left it the right seams. What it
mostly did was close the two gaps the "Still open" list above named.

### One hand loop, driven two ways

`bot/step.ts` holds it. `stepHand(progress, { rng, strategyFor, human? })`
returns what one step did:

| `kind` | Meaning |
|---|---|
| `deal` | The street was owed a board and got it |
| `acted` | A seat acted, and here is the action the engine recorded |
| `hero` | It is the human's turn; **nothing advanced** |
| `complete` | The hand is over; **nothing advanced** |

Dealing is a step of its own rather than folded into the action that closed the
street, because on screen those are two separate moments: a bet lands, then the
cards turn over.

`hero` and `complete` return the progress they were given, by identity, so a
caller can tell that nothing happened without comparing states.

**`playHand` and `playTableHand` are both written over it.** That is the whole
point and it is not a tidiness argument: the 100,000-hand conservation run and
the table on screen differ by one option, so the simulation proves the code the
app actually runs rather than a sibling of it. `strategy/explain.ts` has carried
the general form of this warning since Phase 6 — "that is a second
implementation of the thing the drill does, and the two would drift".

The table split the same way: `startTableHand` deals, `finishTableHand` settles,
moves the button and squares the stacks up, and `playTableHand` is the two with a
loop between.

**Every seat returns to `stackDepth` between hands** (12c). A trainer's table is
not a cash game ledger: you are here to practise the 100bb 6-max spots the charts
describe, and a sitting that drifts to 1,700bb average stacks is being graded
against charts for a game it is no longer playing. `TablePlayer.net` carries the
running result instead, which is the number a player actually wants and the one
`/play` now shows. `chartRecommendation` also checks the **effective stack at the
deal** rather than trusting the depth the table declares, so the coverage rule
holds structurally even if some future table stops squaring up.

### `replayHand`: a hand is a seed and hero's actions

```ts
replayHand({ rng, strategyFor, config, human, humanActions }): ReplayedHand
```

Because every source of randomness is seeded and injected, the deal, the board
and all five opponents' decisions are reproducible from one number. A hand of
six players therefore compresses to a seed, the seating, and **hero's own
actions** — which is what `bot_hands` stores, and why it stores no cards.

It returns `decisions`: the state hero faced before each of their own actions.
That is what post-hand review needs, because grading a spot needs the spot and
not just the action taken in it.

It **throws** on any disagreement — an action the rules reject, one the hand
never needed, one it needed and did not get. The server uses it to check what a
browser claims, and a claim that does not replay is one to refuse rather than
repair.

### Grading lives in `drills/`, and takes plain data

`drills/hand-review.ts` grades hero's decisions inside a hand:

- Postflop → `uncharted: 'postflop'`. No chart family covers it, by construction.
- Preflop with no chart → `uncharted: 'no-chart'`.
- Otherwise → the existing four tiers, plus the full mix.

Exactly one of `grade` and `uncharted` is ever present.

**Note the module.** `tests/grading-isolation.test.ts` forbids anything in
`drills/` from importing `bot/` — "the day it imports one is the day a drill
could be graded against a sampled bot action instead of against a chart".
Recovering the decision points needs `bot/replayHand`. So the recovery happens
on the caller's side and this takes the results as data, which keeps the guard
structural rather than something a later edit could argue past.

The narrowing is worth stating plainly: **"preflop is graded" is too generous.**
With ten charts, hero is graded only when first in or defending the big blind
against a single open. A hand played to the river passes through a dozen spots
and at most one of them can be marked.

### `potBetSizes`

The drill's sizes come from `raiseSizeOptions`, which draws from the chart
*family* so hero's own chart cannot hand over the answer. Bot play has no answer
to hand over and no chart behind most of its spots, so its sizes come from the
pot.

**A pot-sized raise is the call plus the pot after that call.** Facing 3 into
4.5, "pot" is `3 + (4.5 + 3) = 10.5`. Eyeballing it as 4.5 is the most common
sizing error there is, which is reason enough for it to be engine code with a
test rather than arithmetic in a component.

Sizes outside what a stack can reach are **dropped, not clamped** — clamping
collapses three buttons onto one number, and the largest is already offered as
All in.

### Still open

- **A table still seats exactly six**, unchanged and for the same reason.
- **The all-in run-out still deals five cards in one step.** The UI reveals them
  to the next street boundary instead, which is where that belongs: the engine
  has no opinion about pacing.
