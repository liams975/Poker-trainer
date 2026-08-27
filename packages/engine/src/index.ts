/**
 * The public surface of the poker engine.
 *
 * Pure TypeScript: no React, no DOM, no network, no env vars, no Node
 * built-ins, and no runtime dependencies. It must run unchanged in a React
 * Native JS runtime in v2 (docs/01-architecture.md), which is enforced by the
 * `engine/purity` ESLint rules and by this package's tsconfig, not by
 * convention.
 *
 * The module map from docs/03-poker-engine.md is complete as of Phase 3: rng,
 * cards, evaluator, equity, ranges, game, strategy and drills. What remains for
 * v2 — a bot opponent, postflop solving — is new surface, not gaps in this one.
 *
 * Phase 8 adds a ninth, `curriculum`, on the same principle that already puts
 * the chart and drill-template schemas here: content *schemas* live in the
 * engine so they can be validated anywhere, while the content itself lives in
 * `packages/content`. Purity is unaffected.
 *
 * Phase 9 adds a tenth, `progress`. Same principle, one addition: it holds no
 * clock. What a streak is, what makes a skill weak and what an achievement
 * requires are rules, and rules that read `Date.now()` cannot be tested across
 * a DST boundary. Time is injected — see `progress/day.ts`.
 */

export * from './rng';
export * from './cards';
export * from './evaluator';
export * from './equity';
export * from './ranges';
export * from './game';
export * from './strategy';
export * from './drills';
export * from './curriculum';
export * from './progress';
