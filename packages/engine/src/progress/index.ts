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
  AchievementValidation,
  ProgressSnapshot,
} from './achievements';
export {
  ACHIEVEMENT_KINDS,
  evaluateAchievements,
  parseAchievements,
  validateAchievements,
} from './achievements';
