# 02 — Roadmap

Eleven phases. Each is a stopping point with a demoable or verifiable result.
Claude Code plans a phase, you approve, it implements, it stops.

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

---

## Phase 10 — Review, polish, ship

- Session history + mistake log with filters
- Accuracy-over-time charts
- Performance pass, accessibility audit, empty/error state copy
- PostHog funnels, Sentry
- Landing page, deploy

**Exit:** Deployed, monitored, and you can watch a real user complete
onboarding → lesson → drill → review without intervention.

---

## Deliberately deferred to v2

Bot play with post-hand review · spaced repetition scheduling · postflop
track · leaderboards · paywall UI and RevenueCat · iOS app · tournament/ICM ·
multi-table or full-ring.