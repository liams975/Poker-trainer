export type { Answer, Grade, GradeTier, SizeMismatch } from './grade';
export { ACCEPTABLE_THRESHOLD, GRADE_TIERS, SIZE_PENALTY_WEIGHT, gradeAnswer } from './grade';

export type { HandDistribution, SamplingOptions } from './sampling';
export { DEFAULT_UNIFORM_SHARE, actionEntropy, sampleHand, samplingWeights } from './sampling';

export type { DrillSpotKind, DrillTemplate, HandSampling, TemplateError, TemplateValidation } from './template';
export { DRILL_SPOTS, parseDrillTemplates, validateDrillTemplates } from './template';

export type { DrillScenario, DrillSpot, GenerateOptions } from './generate';
export { generateSpot, generateSpots, rebuildSpot } from './generate';

export type {
  AttemptResult,
  GenerateSessionOptions,
  SessionSpot,
  SessionSummary,
} from './session';
export { generateSession, raiseSizeOptions, skillTagsFor, summariseSession } from './session';
