# 02 — Roadmap

v1 shipped in eleven phases, 0 through 10. v2 continues the same numbering
rather than restarting, because the phase-gate protocol in CLAUDE.md keys off
it and a second Phase 1 would make every reference ambiguous.

Each phase is a stopping point with a demoable or verifiable result. Claude Code
plans a phase, you approve, it implements, it stops.

**Ordering principle:** the engine comes before the UI because it is pure,
testable, and everything depends on it. But Phase 6 (Range Explorer) is
deliberately placed early as the first end-to-end vertical slice — it proves
engine → content → DB → UI all connect while being a genuinely useful feature
on its own.

---

## Phase 0 — Foundation

Monorepo scaffold, tooling, CI, CLAUDE.md, docs in place.

- pnpm workspaces + Turborepo; `packages/engine`, `packages/content`, `apps/web`
- TypeScript strict mode, ESLint with the engine import-restriction rule
- Vitest + Playwright configured
- GitHub Actions: typecheck, lint, test on push
- `.env.example`, no real secrets committed

**Exit:** `pnpm typecheck && pnpm test && pnpm lint` all pass on an empty repo.
The engine import-restriction rule provably fails when you try to
`import React` inside `packages/engine`.

---

## Phase 1 — Engine: cards, evaluator, equity

The foundation everything rests on. **Test-first, no exceptions.**

- `Card`, `Rank`, `Suit`, deck construction, parsing (`"As"`, `"Kh"`)
- Canonical hand notation: 169 hands, `AKs` / `AKo` / `77`
- Seeded RNG (`mulberry32` or similar) — deterministic, injectable
- **Two** 7-card evaluators: a naive obviously-correct reference, and a fast
  bitwise/lookup one. Property-test fast against naive on random inputs.
- Monte Carlo equity: hand-vs-hand, hand-vs-range, with seeded RNG

**Exit:** Fast and naive evaluators agree on 1M random 7-card hands.
Known equity benchmarks (e.g. AKs vs QQ ≈ 46%) match within tolerance.
Same seed produces identical results across runs.

---

## Phase 2 — Engine: ranges and chart format

- `Range` type: 169 hands → action frequencies summing to 1.0
- Serialization format + Zod schema; runtime validation on load
- Chart addressing: `(tableSize, stackDepth, heroPosition, actionSequence)`
- Range algebra: union, intersect, subtract, weight, combo counting
- Seed the actual 6-max 100bb charts in `packages/content` (RFI, vs-RFI,
  3-bet, vs-3-bet, blind defense)

**Exit:** Every chart in `packages/content` validates against the schema and
every range's frequencies sum to 1.0 (± float tolerance). Lookup by key
returns the right chart. Combo counts match hand-math expectations.

---

## Phase 3 — Engine: strategy and drill generation

The layer that makes it a *teaching* app.

- `HandState` model — streets, seats, pot, betting history, legal actions
  (model fully now even though v1 only uses preflop)
- `Strategy` interface + `ChartStrategy` implementation (preflop lookup)
- Postflop heuristic stubs: board texture classification, SPR, pot odds
- Structured `Rationale` — renderable reasoning, not prose strings
- Drill scenario generation from templates, seeded and reproducible
- **Grading tiers** (see `docs/03-poker-engine.md`) — never binary

**Exit:** Given a seed, drill generation is fully reproducible. Grading
correctly handles mixed strategies: a 70/30 raise/fold hand grades a fold as
*acceptable*, not wrong. Rationale objects render without engine changes.

---

## Phase 4 — Data layer

- Supabase local dev setup
- Migrations for all tables in `docs/04-data-model.md`
- **RLS on every table, in the creating migration**
- RLS policy tests: an authenticated user cannot read another user's rows
- Content sync script: `packages/content` → Supabase
- Auth: email + OAuth provider

**Exit:** RLS test suite passes, including negative cases. `pnpm db:reset`
rebuilds from scratch and seeds content. Manual check: signing in as user B
returns zero rows from user A's tables.

---

## Phase 5 — Web shell

- App Router layout, route groups, nav
- **Design tokens from `docs/05-ui-ux.md`** — palette, type scale, spacing
- shadcn/ui setup, base components
- Auth flows: sign up, sign in, sign out, protected routes
- Supabase client wiring, TanStack Query provider
- Error boundary, loading states, empty states

**Exit:** You can sign up, land on an empty dashboard, and sign out.
Keyboard focus is visible everywhere. Reduced motion respected.

---

## Phase 6 — Range Explorer *(first vertical slice)*

The study tool. Free-form chart browsing, no drilling. Proves the whole stack.

- 13×13 interactive grid, CSS Grid + DOM
- Action-frequency coloring, colorblind-safe, with non-color redundancy
- Position / scenario selector
- Hand detail on click: exact frequencies, combo count, rationale
- **Side-by-side compare mode** — two charts, diff highlighting
  (this is the desktop-only feature that mobile competitors can't match)

**Exit:** Every seeded chart renders correctly. Compare mode diffs two charts
accurately. Grid is keyboard-navigable. Verified against a colorblind
simulator.

---

## Phase 7 — Drill runner

The core loop.

- Drill session config: mode, length (10/25/50/untimed), filters
- Spot presentation: table, hole cards, action history, decision controls
- **Keyboard shortcuts** — `F`/`C`/`R`, number keys for sizings, `Space` to advance
- Feedback reveal: grade tier, full frequency distribution, rationale, chart
- **Study Mode vs Drill Mode** toggle (see UI doc) — the intentional-study feature
- Session summary
- Persist attempts to `drill_attempts`

**Exit:** A full 25-spot session runs start to finish, playable entirely by
keyboard. Attempts persist with `chart_version`. Mixed-strategy spots display
the full distribution, not a single "right answer".

**Settled during the phase.** Length options are 10/25/50/endless, and the
Drill Mode timer is a separate switch that counts up rather than down. The
⌘K palette moved to Phase 10 — with four destinations it has little to jump
between until lessons exist. `xp_events` and `skill_stats` stay empty: both are
derivable from `drill_attempts`, so Phase 9 builds them without a backfill.
Writes go through `/api/drill/*` Route Handlers rather than Server Actions,
because Next's action queue drops concurrent dispatches and was losing about
half of every session — see `docs/05-ui-ux.md`.

---

## Phase 8 — Lessons and progression

- Lesson content format + renderer (text, visuals, embedded mini-drills)
- Track/module structure, unlock rules
- Progress persistence
- Placement assessment on onboarding → drops user at the right point

**Exit:** A user completes a lesson, progress persists across reload, next
lesson unlocks. Placement assessment routes a strong player past basics.

**Settled during the phase.** The track is one course — "Preflop
fundamentals", 3 modules and 10 lessons — scoped to exactly what the ten
seeded charts support. Unlocking is linear across the flattened track, and
placement is honoured in the unlock *rule* rather than by writing `completed`
rows for lessons nobody opened. Migration `0003` adds a `placement` drill mode
so Phase 9 can keep the diagnostic out of accuracy stats the way it will keep
`study` out. `skill_stats` and `xp_events` are still empty and still derivable
from `drill_attempts`.

---

## Phase 9 — Progress and gamification *(moderate depth)*

Scoped deliberately: streaks, XP, daily goal, achievements, weak-spot
tracking. **No leagues, no hearts/lives, no leaderboards in v1.**

- XP as an append-only event ledger; totals derived
- Streak logic with timezone handling (subtle — test it)
- Daily goal ring
- Weak-spot detection from `skill_stats` EWMA accuracy
- Achievements

**Exit:** Streak survives a timezone change and does not break across DST.
Weak spots reflect actual recent performance. XP totals reconcile with the
ledger.

**Settled during the phase.** The streak grace policy — open since Phase 4 — is
**strict**: one missed day resets it, and the mitigation is warning people
while they can still act, not a grace period. A tenth engine module,
`progress`, holds the rules and deliberately holds no clock; the timezone is
applied in one function at the web boundary. `skill_stats` is a cache
recomputed from `drill_attempts` at session close rather than a counter, and
XP is written by the server when a session closes, keyed so a retried request
cannot pay twice. Migration `0004` adds that key, closes the `xp_events.reason`
vocabulary, and constrains achievement criteria. Session Review was marked
Phase 9 in `modes.ts` against this document and is corrected to Phase 10.

---

## Phase 10 — Review, polish, ship

- Session history + mistake log with filters
- Accuracy-over-time charts
- Performance pass, accessibility audit, empty/error state copy
- PostHog funnels, Sentry
- Landing page, deploy

**Exit:** Deployed, monitored, and you can watch a real user complete
onboarding → lesson → drill → review without intervention.

**Settled during the phase.** Session Review reads `drill_attempts` back and
**replays** each spot from its stored scenario rather than describing it, using
the frequencies and `chart_version` on the row — so a chart retune cannot
rewrite what you were told at the time. ⌘K landed without a dependency, reusing
Phase 7's keyboard guard. The landing page renders from the *bundled* content,
because RLS correctly refuses an anonymous visitor every `range_charts` row.
Migration `0005` closes the attempt/session ownership gap `docs/05` had flagged
since Phase 7, now that Phase 9 computes session aggregates server-side.

The accessibility audit became `e2e/a11y.spec.ts` rather than an afternoon, and
found six real defects — including a `role="grid"` with no rows, which had made
the 13×13 matrix structurally meaningless to a screen reader since Phase 6.
Operations moved into `docs/07-operations.md`.

---

# v2

v1 works. What it is not is *enjoyable to study with* — which is a product
problem, not a correctness one, and the whole of v2 so far is aimed at it.

## Phase 11 — the table, the icon, and motion

- `game/seating.ts`: the ring as a projection of `HandState`
- The six-seat strip becomes a real table — hero at the bottom, dealer button,
  chips to a centre pot, every seat's action in words at its seat
- A playing-card favicon, which the app had never had
- `motion` installed at last, and the milestone moments it makes possible

**Exit:** The spot reads as a table, the deal animates, and reduced motion is
honoured by the animations themselves rather than only by the stylesheet.

**Settled during the phase.** Two amendments to `docs/05-ui-ux.md`'s design
thesis, both taken deliberately: the app takes the **shape** of a poker table
but none of the casino palette, and it now **celebrates milestones — never
individual answers**. The second line is the same rule the four grade tiers
encode, held one layer further out.

The load-bearing discovery: the global CSS `prefers-reduced-motion` block does
nothing for JS-driven animation, and the test guarding it would have gone on
passing while every new animation ignored the preference. Verified by mutation —
with `reducedMotion` disabled, `shell.spec.ts` stays entirely green and only the
new `motion.spec.ts` fails.

## Phase 12a — the engine plays a whole hand

- `game/pot.ts`, `game/settle.ts` — side pots, showdown, the pot award
- `game/dealer.ts` — a shuffled deck, dealt from a seed
- `strategy/heuristic-strategy.ts` — decisions where no chart reaches
- `bot/` — the eleventh engine module: sampling, a hand, a table

**Exit:** A hundred thousand simulated hands conserve chips exactly, every
action is legal, every hand terminates, and the same seed replays identically.

**Settled during the phase.** `docs/01-architecture.md` promised bot play would
be "mostly UI work because the decision-making already exists". It does not.
The seeded content is **ten charts** — RFI for five seats, big-blind defence
against five openers — and `chart-strategy.ts` throws everywhere else by
design, so a bot could not complete one preflop orbit. There was no postflop
decision-making at all, deliberately.

So the phase split. 12a builds a heuristic that decides where charts do not
reach, and it drives the **bot only** — `heuristics.ts`'s refusal to grade
against invented logic is narrowed to its actual reason rather than reversed,
and two source-level guards enforce the narrowing.

`betting.ts`'s two Phase 3 omissions — no side pots, no showdown — are closed.
Chip conservation over a long session is what proves it: a side-pot bug does
not crash, it silently pays the wrong player.

## Phase 12b — bot play, playable

- `bot/step.ts` — one hand loop, driven by the simulation and by the screen
- `bot/hand.ts`'s `replayHand` — a hand from a seed and hero's actions alone
- `drills/hand-review.ts` — graded where a chart reaches, reported everywhere else
- `/play` — a seat at a six-handed cash table
- `bot_sessions` and `bot_hands`, with RLS and grants (migration `0006`)
- The poker table reaches the **Range Explorer** and the lesson `range` block

**Exit:** A hand deals, plays out against five bots, reaches a showdown and is
written to Postgres from the server's own replay. Every decision hero made is
reported afterwards; the ones a chart covers carry a tier and the rest say why
they do not.

**Settled during the phase.** Three things.

**One loop, not two.** The screen and the 100,000-hand conservation simulation
both drive `stepHand`; the only difference is a `human` option that makes it
stop at hero's seat. A second UI-shaped loop would have left the conservation
proof covering a sibling of the code you actually play, which is the failure
`strategy/explain.ts` has warned about since Phase 6.

**The client does not decide what is stored.** A browser posts the seed, the
seating, the stacks and its own actions — nothing downstream of the deal. The
server replays the hand and writes the actions and result *it* derives. A
replay that disagrees is refused with a 409 rather than repaired.

**"Preflop graded" turned out to be too generous.** With ten charts, hero is in
charted territory only when first in or defending the big blind against one
open; every other preflop decision and all postflop are uncharted. So the rule
is *graded where a chart reaches*, and the uncharted case says so on screen
rather than being hidden or quietly scored. That makes the missing charts
visible as a hole in the product, which is the best argument yet for closing
them.

## Phase 12c — reviewing bot play *(next)*

The review screen for the hands 12b records: filters, a hand replayer, leaks
across a sitting. And whether playing earns anything — no XP, streak or
achievement is awarded for a bot hand today, deliberately, because XP for
*playing* rather than for answering is farmable by folding.

## Later

**The missing preflop charts** — cold-calls, 3-bets, vs-3-bets, squeezes. The
highest-value content work left: they would let the bot play chart-driven poker
far deeper into the tree, and unlike heuristics they could also grade.

Spaced repetition scheduling · postflop track · leaderboards · achievement
gallery · dashboard rebuild · daily quests · paywall UI and RevenueCat · iOS
app · tournament/ICM · multi-table or full-ring.