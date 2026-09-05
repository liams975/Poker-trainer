import type { Achievement, LevelProgress, SkillStat, StreakStatus } from '@poker/engine';

/**
 * The shape of a finished session's payout, shared by both ends of the wire.
 *
 * In its own file with no imports beyond the engine, because `record.ts` pulls
 * in the server Supabase client and the drill runner is a client component. A
 * `import type` from there would be erased at build time and work — right up
 * until somebody adds a value import to the same line.
 */

export interface StreakReport {
  current: number;
  longest: number;
  status: StreakStatus;
  /** True when this call was the one that counted today. */
  extendedToday: boolean;
}

export interface DailyGoalReport {
  done: number;
  target: number;
  met: boolean;
}

export interface SessionRewards {
  /** XP written by this call. Zero for an unscored mode or a repeated close. */
  xpAwarded: number;
  totalXp: number;
  level: LevelProgress;
  /**
   * The level this session started at, so the client knows whether to mark a
   * level-up without keeping its own copy of the number.
   *
   * Derived here rather than remembered there. The summary's governing rule is
   * that every figure in it came back from the server that wrote it — a client
   * diffing a level it cached before the session is a second arithmetic over
   * one ledger, and a reload mid-session would silently lose the "before".
   */
  levelBefore: number;
  streak: StreakReport;
  dailyGoal: DailyGoalReport;
  /** Achievements this call was the first to record. */
  unlocked: readonly Achievement[];
  weakSpots: readonly SkillStat[];
}
