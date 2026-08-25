/**
 * The action vocabulary.
 *
 * These exact strings are the `poker_action` Postgres enum
 * (supabase/migrations/0001_initial_schema.sql), and they are written into
 * `range_charts.ranges` and `drill_attempts.user_action`. Drift between this
 * list and the enum is a runtime insert failure, not a type error, so the
 * ordering and spelling here are fixed by the migration rather than by taste.
 */

export const ACTIONS = ['fold', 'check', 'call', 'bet', 'raise', 'allin'] as const;

export type Action = (typeof ACTIONS)[number];

/** Actions that carry a bet size. */
export const SIZED_ACTIONS: readonly Action[] = ['bet', 'raise'];

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

/**
 * How aggressive an action is, used only as a deterministic tiebreak. Higher
 * is more aggressive; it carries no strategic meaning.
 */
export function aggressionRank(action: Action): number {
  return ACTIONS.indexOf(action);
}
