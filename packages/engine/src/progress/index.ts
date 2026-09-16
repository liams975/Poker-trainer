export type { Day } from './day';
export { addDays, dayDiff, isDay } from './day';

export type { AdvanceStreakOptions, StreakAdvance, StreakState, StreakStatus } from './streak';
export { STREAK_STATUSES, advanceStreak, effectiveStreak, streakStatus } from './streak';

export type { LevelProgress, XpReason } from './xp';
export {
  DAILY_GOAL_SPOTS,
  SCORED_DRILL_MODES,
  XP_ACHIEVEMENT,
  XP_DAILY_GOAL,
  XP_LESSON_COMPLETE,
  XP_PER_TIER,
  XP_REASONS,
  isScoredMode,
  levelFor,
  totalXp,
  xpForAttempts,
} from './xp';

export type { SkillStat, StatAttempt, WeakSpotOptions } from './stats';
export {
  EWMA_ALPHA,
  WEAK_SPOT_CEILING,
  WEAK_SPOT_LIMIT,
  WEAK_SPOT_MIN_ATTEMPTS,
  rollUpSkillStats,
  weakSpots,
} from './stats';

export type { NextRank, PlayerRank, RankTier, RankedAttempt } from './rank';
export { RANK_DIVISIONS, RANK_MIN_SPOTS, RANK_TIERS, evLossPerSpot, rankFor } from './rank';

export type { Mastery, MasteryAttempt, NextMastery } from './mastery';
export {
  MASTERY_LEVELS,
  MASTERY_THRESHOLDS,
  MASTERY_WINDOW,
  masteryFor,
  totalMasteryLevels,
} from './mastery';

export type {
  DayPoint,
  HistoryAttempt,
  HistoryWindow,
  SessionDigest,
  TagBreakdown,
} from './history';
export { MAX_HISTORY_DAYS, accuracyOverTime, sessionDigest } from './history';

export type {
  Achievement,
  AchievementCriteria,
  AchievementError,
  AchievementKind,
  AchievementProgress,
  AchievementValidation,
  ProgressSnapshot,
} from './achievements';
export {
  ACHIEVEMENT_KINDS,
  achievementProgress,
  evaluateAchievements,
  parseAchievements,
  validateAchievements,
} from './achievements';
