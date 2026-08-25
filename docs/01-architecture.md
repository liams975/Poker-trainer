# 01 — Architecture

## The shape of the system

The single most important property of this design:

> **All poker logic is pure functions over data, running on the client.
> The server handles identity, persistence, content delivery, and social only.**

This is what makes a solo build tractable and hosting near-free. No solver
runs. No per-request compute cost. Drills work offline. Scaling users costs
you database rows, not CPU.

```
┌─────────────────────────────────────────────┐
│  apps/web  (Next.js, all UI)                │
│  ┌───────────────────────────────────────┐  │
│  │  packages/engine   pure TS            │  │
│  │  cards · evaluator · equity · ranges  │  │
│  │  strategy · drills · game-state       │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  packages/content  versioned JSON     │  │
│  └───────────────────────────────────────┘  │
└──────────────────┬──────────────────────────┘
                   │ supabase-js (anon key + RLS)
┌──────────────────▼──────────────────────────┐
│  Supabase: Postgres · Auth · RLS · Storage  │
│  Edge Functions for anything privileged     │
└─────────────────────────────────────────────┘
```

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Best-in-class React DX; you get SSR for marketing pages free when you need them |
| Styling | Tailwind + shadcn/ui | Dense desktop UI fast; shadcn is copy-in, so no version lock-in |
| Client state | Zustand | Drill session state is ephemeral and local |
| Server state | TanStack Query | Caching, optimistic updates, retry |
| Charts/grids | DOM + CSS Grid | 169 cells is trivial for the DOM. **Do not reach for canvas.** |
| Animation | Framer Motion | Feedback micro-interactions |
| Backend | Supabase | Postgres + Auth + RLS + Storage in one; you already know it |
| Hosting | Vercel | Zero-config Next.js |
| Analytics | PostHog | Funnels + flags, generous free tier |
| Errors | Sentry | |
| Unit tests | Vitest | Fast, TS-native |
| E2E | Playwright | Also gives you keyboard-shortcut testing |
| Monorepo | pnpm workspaces + Turborepo | |

**Explicitly not used in v1:** react-native-skia, Expo, canvas rendering,
any solver library, any third-party poker API. None exist that you'd want —
the logic is yours, which means no dependency risk and no per-call cost.

## Why a monorepo when there's one app

Because in v2 there are two. The engine and content packages are the
expensive, correctness-critical parts, and they are 100% portable to a React
Native runtime. Setting the boundary now costs one afternoon. Retrofitting it
later means untangling poker logic from React components.

The rule that preserves this: **`packages/engine` may not import React,
Next.js, `window`, `document`, `process.env`, or any Node built-in.** Enforce
it with an ESLint `no-restricted-imports` rule so it fails CI rather than
relying on discipline.

## v2 seams to build now (interfaces only, no implementation)

Designing these in now is cheap. Adding them later is a refactor.

**1. The `Strategy` interface is shared by drills and bots.**

```ts
interface Strategy {
  recommend(state: HandState, hero: Seat): ActionRecommendation;
}
```

A drill calls `recommend()` and compares it to the user's answer.
A v2 bot calls `recommend()` and samples an action from the distribution.
*Same function.* This is the seam that makes bot play cheap later — the
strategy layer is already written and tested by the time you need it.

**2. `HandState` models a full hand, not just a preflop spot.**
Even though v1 only drills preflop decisions, model streets, pot, betting
history, and legal actions from the start. Postflop drills and bot play both
need it, and widening a narrow model later touches every call site.

**3. Entitlements exist, gating doesn't.**
Ship the `entitlements` table and a `useEntitlement()` hook returning
`'free' | 'pro'`. In v1 everything is unlocked and there is no paywall UI.
Retrofitting gating into a mature app is painful; shipping a paywall on an
unproven product is worse. Build the seam, skip the wall.

**4. `review_queue` table exists, SRS algorithm doesn't.**
Spaced repetition is the real "beginner → expert" mechanism and your
strongest future subscription justification. Log the data now so that when
you build it in v2 you have history to work with.

## Content as data, not code

Range charts and lesson content live in `packages/content` as
schema-validated JSON, and are synced to Supabase. Two consequences:

- You can tune strategy or fix a lesson typo **without a deploy** (and in v2,
  without an App Store resubmission — a large quality-of-life win).
- Content is versioned, so a user's past drill attempts stay interpretable
  when a chart changes. Always record `chart_version` on an attempt.

## Security posture

The realistic attack surface for this app, in priority order:

1. **Supabase RLS gaps.** The classic data leak. Default-deny everywhere;
   test policies as part of the suite, not by eyeballing them.
2. **Entitlement bypass** (relevant from v2 on). The client never
   self-certifies premium. RevenueCat webhook → Edge Function → entitlement
   row. Client reads that row, never writes it.
3. **Leaderboard integrity.** Because strategy logic is client-side, a user
   can trivially fake a score. Either validate server-side or accept it as
   honor-system and keep leaderboards cosmetic. Never let client-computed
   values gate money or unlock content.
4. **Secrets in the bundle.** Only the anon key and PostHog public key belong
   in the client. Both are safe *given correct RLS* — which is why item 1 is
   first.