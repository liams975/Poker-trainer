/**
 * The public surface of the poker engine.
 *
 * Pure TypeScript: no React, no DOM, no network, no env vars, no Node
 * built-ins, and no runtime dependencies. It must run unchanged in a React
 * Native JS runtime in v2 (docs/01-architecture.md), which is enforced by the
 * `engine/purity` ESLint rules and by this package's tsconfig, not by
 * convention.
 *
 * Modules are added as they are written, so the module map in
 * docs/03-poker-engine.md is only partly present: `ranges` arrives in Phase 2,
 * `game`, `strategy` and `drills` in Phase 3.
 */

export * from './rng';
export * from './cards';
export * from './evaluator';
export * from './equity';
