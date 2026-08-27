export type {
  BlockKind,
  CalloutTone,
  CurriculumError,
  CurriculumModule,
  CurriculumContext,
  CurriculumValidation,
  Lesson,
  LessonBlock,
  Track,
} from './lesson';
export {
  BLOCK_KINDS,
  CALLOUT_TONES,
  moduleOf,
  orderedLessons,
  parseTracks,
  validateTracks,
} from './lesson';

export type { LessonStatus, ProgressRow, ProgressionOptions, TrackSummary } from './progression';
export { LESSON_STATUSES, lessonStates, nextLesson, trackProgress } from './progression';

export type {
  GroupEvidence,
  PlacementAttempt,
  PlacementGroup,
  PlacementOptions,
  PlacementResult,
  TagEvidence,
} from './placement';
export { PLACEMENT_MIN_ATTEMPTS, PLACEMENT_THRESHOLD, placeFrom, placementOrder } from './placement';
