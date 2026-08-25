# Poker Trainer

A gamified poker training web app teaching 6-max cash game fundamentals and
GTO-flavored play to experienced beginners. **v1 is desktop web only.**

## Scope, in one paragraph

Desktop web app teaching 6-max cash game poker (Texas Hold'em, 100bb, no ICM)
to experienced beginners. Strategy comes from preflop range charts plus
postflop heuristics, not a solver. All poker logic is pure client-side
TypeScript in `packages/engine`; Supabase handles identity, persistence, and
content. v1 ships with moderate gamification and no paywall. v2 adds bot play,
spaced repetition, monetization, and an iOS app that reuses the engine
unchanged.

## Layout

```
packages/
  engine/     Pure poker logic. No React. No DOM. No network. No env vars.
  content/    Range charts + lesson content as versioned, schema-validated JSON
apps/
  web/        Next.js app. All UI.
supabase/
  migrations/ Ordered SQL. Never edit an applied migration — add a new one.
docs/         Specs. Read the relevant one before starting a phase.
```

## Getting started

Requires Node ≥ 22 and pnpm.

```bash
pnpm install
pnpm dev            # web app on :3000
```

```bash
pnpm test           # vitest, all packages
pnpm test:engine    # engine only, watch mode
pnpm test:e2e       # playwright
pnpm typecheck      # tsc --noEmit across workspace
pnpm lint
pnpm db:migrate     # apply migrations locally   (Phase 4)
pnpm db:reset       # wipe + remigrate + seed    (Phase 4)
```

Copy `.env.example` to `.env.local` before running against a real Supabase
project. The `db:*` scripts require the Supabase local stack, set up in Phase 4.

## Documentation

| Doc | Contents |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Reference card — locked decisions, always/never rules |
| [`docs/01-architecture.md`](docs/01-architecture.md) | Locked decisions + rationale |
| [`docs/02-roadmap.md`](docs/02-roadmap.md) | 11 phases with exit criteria |
| [`docs/03-poker-engine.md`](docs/03-poker-engine.md) | Module design + test plan |
| [`docs/04-data-model.md`](docs/04-data-model.md) | Schema reasoning |
| [`docs/05-ui-ux.md`](docs/05-ui-ux.md) | Design tokens, homepage, desktop UX |
| [`docs/06-claude-code-workflow.md`](docs/06-claude-code-workflow.md) | Agents, skills, anti-sprawl |

Work proceeds in numbered phases. Each phase is planned, approved, implemented,
and stopped at its exit criteria — see the phase gate protocol in `CLAUDE.md`.

## Three decisions worth re-reading before you start

1. **The engine is pure and portable.** No React, DOM, or env vars in
   `packages/engine`. This is what makes the v2 iOS app cheap, and it's
   enforced by a lint rule rather than discipline.

2. **Grading is never binary.** Ranges are mixed strategies. A four-tier
   grade with the full frequency distribution shown every time is both the
   pedagogically correct choice and the thing that earns trust from players
   who already know some theory.

3. **Build the seams, skip the walls.** Entitlements table, `review_queue`,
   and full `HandState` all ship in v1 unused. Adding tables later is easy;
   backfilling history you never recorded is impossible.
