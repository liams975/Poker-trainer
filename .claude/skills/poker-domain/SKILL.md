---
name: poker-domain
description: The poker domain model for this trainer — 6-max position order, 169-hand notation, the range data format, chart addressing, and the four grading tiers. Load before writing or reviewing any code that touches hands, ranges, charts, strategy or grading.
---

# Poker domain model

The vocabulary and data shapes this codebase commits to. Without these,
plausible-sounding poker specifics get invented: made-up position names, ranges
treated as include/exclude sets, "correct answer" grading. All three are wrong
here.

Full detail lives in `docs/03-poker-engine.md`. This is the working reference.

## Scope, fixed

Texas Hold'em, 6-max cash, 100bb effective, no ICM. Not a solver — strategy is
preflop range charts plus postflop heuristics.

## Positions

Six, in this order:

```
UTG · HJ · CO · BTN · SB · BB
```

UTG is first to act preflop, BB last. There is no MP or LJ in a 6-max game —
do not introduce them.

## Hand notation

169 canonical starting hands, written three ways:

| Form | Meaning | Combos |
|---|---|---|
| `77` | pocket pair | 6 |
| `AKs` | suited | 4 |
| `AKo` | offsuit | 12 |

Ranks descend `A K Q J T 9 8 7 6 5 4 3 2` — always `T`, never `10`. The higher
card comes first: `AKo`, never `KAo`. Individual cards parse as rank + suit
lowercase: `As`, `Kh`, `7d`, `2c`.

The 169 decomposes as 13 pairs + 78 suited + 78 offsuit.

## Ranges are mixed strategies

**The single most important rule in this domain.** A range maps each of the 169
hands to a frequency distribution over actions, summing to 1.0:

```ts
type ActionFreq = { action: Action; size?: number; freq: number };
type Range = Record<HandNotation, ActionFreq[]>;
```

`AJo` from the cutoff might be 60% open / 40% fold. That is not an edge case or
a rounding artifact — it is the normal, correct state of a solved range.

Any code that reduces a hand to one right answer is wrong. That includes UI
that shows a single action per cell, grading that returns a boolean, and any
type that models a range as `Set<HandNotation>`.

## Chart addressing

```ts
type ChartKey = {
  tableSize: 6;
  stackDepth: 100;
  heroPosition: Position;   // UTG | HJ | CO | BTN | SB | BB
  actionSequence: string;   // "rfi" | "vs_utg_open" | "bb_vs_btn_open" | ...
};
```

`tableSize` and `stackDepth` stay in the key even though v1 hardcodes both.
Widening this later would touch every call site.

Charts live in `packages/content` as versioned, schema-validated JSON — never
hardcoded in components or engine logic. Every drill attempt records the
`chart_version` it was graded against, so history stays interpretable when a
chart changes.

## Grading: four tiers, never binary

| Tier | Condition |
|---|---|
| **Optimal** | the highest-frequency action |
| **Acceptable** | frequency ≥ 0.15, but not primary |
| **Inaccurate** | frequency > 0 but < 0.15 |
| **Blunder** | frequency = 0 |

Boundaries are exact: 0.15 is *acceptable*. Zero is a *blunder*, not merely
inaccurate.

Two consequences that follow from this and are not optional:

1. **Always show the full distribution after an answer.** Teaching someone that
   `AJo` "is a fold" when it opens 40% of the time actively makes them a worse
   player. The mix is the lesson.
2. **Score by EV loss, not accuracy percentage.** A blunder in a big pot should
   cost more than a marginal frequency error. For preflop chart spots, use
   frequency-weighted distance from the primary action as the proxy.

## Determinism

Everything random goes through the seeded RNG in `engine/rng`, injected — never
bare `Math.random()`. This buys reproducible drills (a spot can be shared or
replayed), stable tests, and exact regeneration of a historical attempt from
its stored seed. Every `drill_attempt` stores its `seed`.

## Rationale is structured data

Never a prose string:

```ts
{ factors: [{ kind: 'position', weight: 'high', detail: ... }, ...] }
```

Structure lets the UI render chips, highlights, or verbose prose depending on
Study vs Drill mode without touching the engine. A string locks in one
presentation and cannot be styled or filtered.
