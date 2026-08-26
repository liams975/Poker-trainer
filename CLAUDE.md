# CLAUDE.md

Reference card for this repo. Keep it short. Detail lives in `/docs` — link, don't inline.

## What this is

A gamified poker training web app teaching 6-max cash game fundamentals and
GTO-flavored play to experienced beginners. **v1 is desktop web only.** iOS
comes in v2 after v1 ships.

## Locked decisions — do not relitigate

These were decided in planning. If you think one is wrong, **stop and ask the
human**. Do not silently work around them.

| Decision | Value |
|---|---|
| Game scope | Texas Hold'em, 6-max cash, 100bb, no ICM |
| Strategy model | Preflop charts + postflop heuristics. **Not** a real solver. |
| Platform (v1) | Desktop web. Not mobile-responsive-first. |
| Frontend | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui |
| Backend | Supabase (Postgres + Auth + RLS). No custom API server. |
| Engine location | `packages/engine` — pure TS, zero React/DOM/Node-API deps |
| Monetization (v1) | Entitlement seam built, **no paywall UI shipped** |
| Bot play | v2. Scaffold the interfaces, don't build the bot. |

Full rationale: `docs/01-architecture.md`

## Repo layout

```
packages/
  engine/     Pure poker logic. No React. No DOM. No network. No env vars.
  content/    Range charts + lesson content as versioned, schema-validated JSON
apps/
  web/        Next.js app. All UI.
supabase/
  migrations/ Ordered SQL. Never edit an applied migration — add a new one.
  tests/      pgTAP policy suite. Run with `pnpm db:test`.
scripts/      Workspace tooling. Owns the content sync and the DB test suite.
docs/         Specs. Read the relevant one before starting a phase.
```

## Commands

```bash
pnpm dev            # web app on :3000
pnpm test           # vitest, all packages
pnpm test:engine    # engine only, watch mode
pnpm typecheck      # tsc --noEmit across workspace
pnpm lint
pnpm db:start       # local Supabase stack (needs Docker)
pnpm db:stop
pnpm db:migrate     # apply migrations locally
pnpm db:reset       # wipe + remigrate + sync content from packages/content
pnpm db:test        # pgTAP policy suite (supabase/tests/database)
pnpm test:db        # RLS through supabase-js, as two real signed-up users
pnpm content:sync   # packages/content -> Supabase
```

`pnpm test` is hermetic and never needs Docker. Everything under `db:` does.
Get credentials with `supabase status -o env` after `pnpm db:start`.

## Always

- **Read the phase spec in `/docs` before writing code for that phase.**
- **Test-drive `packages/engine`.** Write the failing test first. Engine
  correctness is the product's credibility.
- Enable RLS on every new table, in the same migration that creates it.
- Use the seeded RNG from `engine/rng` for anything random. Never bare
  `Math.random()` — it makes drills irreproducible and tests flaky.
- Keep strategy content in `packages/content` as data, never hardcoded in
  components or engine logic.
- Derive totals from event tables (`xp_events`), don't store mutable counters.

## Never

- Never put poker logic in a React component. It belongs in `packages/engine`.
- Never import React, `next/*`, `window`, or `process.env` inside
  `packages/engine`. It must run in a React Native JS runtime unchanged in v2.
- Never create a table without an RLS policy. Default deny. **And grant it
  explicitly** — grants and RLS are independent layers, and this CLI no longer
  auto-exposes new tables to the Data API roles. `0002` also revoked the
  default privilege that handed `anon` and `authenticated` `Dxtm` (TRUNCATE,
  REFERENCES, TRIGGER, MAINTAIN) on every new table — TRUNCATE is not filtered
  by RLS. So a new table now starts with nothing for those two roles, and
  `service_role` still needs its DML granted explicitly. Do it in the migration
  that creates the table.
- Never let the client decide entitlement. Server-written rows only.
- Never grade a drill as binary right/wrong — ranges are mixed strategies.
  See the grading tiers in `docs/03-poker-engine.md`.
- Never use color alone to encode strategy actions. Palette is
  colorblind-safe and every action also carries a glyph or label.
- Never add a dependency without saying why in the PR/commit message.

## Phase gate protocol

Work proceeds in numbered phases (`docs/02-roadmap.md`). For each phase:

1. Read the phase spec.
2. **Enter plan mode. Produce a plan. Wait for approval.** Do not write code
   until the human approves the file list.
3. Implement only what the approved plan lists.
4. Run `pnpm typecheck && pnpm test && pnpm lint`.
5. Stop at the phase exit criteria and report. Do not roll into the next phase.

If a phase turns out to need files the plan didn't list, stop and ask rather
than expanding scope mid-phase.

## Poker domain invariants

- Positions in 6-max, in order: `UTG, HJ, CO, BTN, SB, BB`.
- 169 canonical starting hands. Notation: `AKs`, `AKo`, `77`.
- A range maps each of the 169 hands to action frequencies summing to 1.0.
- Mixed strategies are normal and correct. A hand can be 70% raise / 30% fold.
- Chart lookup key: `(tableSize, stackDepth, heroPosition, actionSequence)`.

## Security rules

- Client holds only the Supabase anon key. Anything privileged runs in an
  Edge Function with the service role key.
- Every user-data table: users read and write **their own rows only**.
- Content tables: authenticated read, service-role write.
- Validate all user input at the DB boundary with constraints, not just in TS.
- Every `security definer` function pins `set search_path = ''` and
  schema-qualifies its references. An unpinned one is a privilege-escalation
  vector, not a style nit.
- Skill tags are a closed vocabulary enforced by the database: a foreign key
  on scalar columns, a trigger on `text[]` columns. Add tags in
  `packages/content/src/skill-tags.ts` and re-run `pnpm content:sync`.