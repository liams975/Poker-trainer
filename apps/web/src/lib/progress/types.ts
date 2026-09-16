import type {
  Achievement,
  AchievementProgress,
  LevelProgress,
  Mastery,
  PlayerRank,
  SkillStat,
  StreakStatus,
} from '@poker/engine';

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

/** One badge in the gallery — frame 2h. Locked ones carry their own progress. */
export interface GalleryBadge {
  achievement: Achievement;
  unlocked: boolean;
  progress: AchievementProgress;
}

export interface AchievementGallery {
  badges: readonly GalleryBadge[];
  unlockedCount: number;
}

/** One skill on the mastery map: the engine's verdict, plus what to call it. */
export interface SkillMastery extends Mastery {
  skillTag: string;
  label: string;
  /** Recent accuracy, for display only — the level is gated on EV loss. */
  accuracy: number | null;
}

/** One row of the weekly board, as `public.weekly_leaderboard()` returns it. */
export interface BoardRow {
  position: number;
  handle: string;
  evLossPerSpot: number;
  spots: number;
  /** The only identity the board resolves, and only for the caller. */
  isYou: boolean;
}

export interface MasterySnapshot {
  skills: readonly SkillMastery[];
  /** Levels earned over levels available — "29 of 50". */
  levelsEarned: number;
  levelsAvailable: number;
  /** `undefined` below the 200-spot minimum, where no rank has been earned. */
  rank: PlayerRank | undefined;
  /** Empty when nobody qualifies, which is the normal state of a new week. */
  board: readonly BoardRow[];
  /** Whether this reader has opted into the board, and under what handle. */
  participation: { optedIn: boolean; handle: string | null };
}
