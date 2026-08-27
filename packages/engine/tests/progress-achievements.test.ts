import { describe, expect, it } from 'vitest';

import type { Achievement, ProgressSnapshot, SkillStat } from '../src/progress';
import { evaluateAchievements, parseAchievements } from '../src/progress';

/**
 * Achievements are content, validated the way charts and lesson blocks are.
 *
 * The failure mode this guards against is specific: an achievement whose
 * criteria nothing can ever satisfy is *invisible*. It syncs cleanly, sits in
 * the table, and never unlocks for anybody — there is no error, no empty box on
 * a page, nothing to notice. So the validator refuses a criteria shape the
 * evaluator does not understand, at load and again at sync.
 */

function ok(raw: unknown): readonly Achievement[] {
  const result = parseAchievements(raw);
  if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
  return result.value;
}

function errors(raw: unknown): readonly string[] {
  const result = parseAchievements(raw);
  if (result.ok) throw new Error('expected the validator to reject this');
  return result.errors.map((error) => `${error.path}: ${error.message}`);
}

const VALID = [
  { id: 'spots-100', title: 'Hundred spots', description: 'Answer 100 spots.', criteria: { kind: 'spots', count: 100 } },
  { id: 'streak-7', title: 'A week', description: 'Seven days running.', criteria: { kind: 'streak', days: 7 } },
  { id: 'lessons-1', title: 'First lesson', description: 'Finish a lesson.', criteria: { kind: 'lessons', count: 1 } },
  {
    id: 'mastery-90',
    title: 'Sharp',
    description: 'Hold 90% on a skill.',
    criteria: { kind: 'mastery', accuracy: 0.9, minAttempts: 30 },
  },
];

function snapshot(overrides: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
  return { spots: 0, streak: 0, lessonsCompleted: 0, stats: [], ...overrides };
}

function stat(skillTag: string, ewmaAccuracy: number, attempts: number): SkillStat {
  return {
    skillTag,
    attempts,
    correct: Math.round(ewmaAccuracy * attempts),
    ewmaAccuracy,
    avgEvLoss: 0,
  };
}

describe('parseAchievements', () => {
  it('accepts a well-formed set', () => {
    expect(ok(VALID)).toHaveLength(4);
  });

  it('rejects a criteria kind the evaluator does not implement', () => {
    const raw = [{ ...VALID[0], criteria: { kind: 'hands_played', count: 10 } }];
    expect(errors(raw).join()).toMatch(/hands_played/);
  });

  it('rejects a criteria that is not an object', () => {
    expect(errors([{ ...VALID[0], criteria: 'spots-100' }]).join()).toMatch(/criteria/);
  });

  it('rejects a threshold that nothing could ever reach or that everything meets', () => {
    expect(errors([{ ...VALID[0], criteria: { kind: 'spots', count: 0 } }]).join()).toMatch(/count/);
    expect(errors([{ ...VALID[0], criteria: { kind: 'spots', count: -5 } }]).join()).toMatch(/count/);
    expect(errors([{ ...VALID[1], criteria: { kind: 'streak', days: 0 } }]).join()).toMatch(/days/);
  });

  it('rejects a mastery accuracy outside 0..1', () => {
    expect(
      errors([{ ...VALID[3], criteria: { kind: 'mastery', accuracy: 90, minAttempts: 30 } }]).join(),
    ).toMatch(/accuracy/);
  });

  it('rejects a mastery bar low enough to be automatic', () => {
    expect(
      errors([{ ...VALID[3], criteria: { kind: 'mastery', accuracy: 0.9, minAttempts: 0 } }]).join(),
    ).toMatch(/minAttempts/);
  });

  it('rejects duplicate ids', () => {
    expect(errors([VALID[0], { ...VALID[1], id: 'spots-100' }]).join()).toMatch(/spots-100/);
  });

  it('requires a title and a description, because both are shown to the user', () => {
    expect(errors([{ ...VALID[0], title: '' }]).join()).toMatch(/title/);
    expect(errors([{ ...VALID[0], description: undefined }]).join()).toMatch(/description/);
  });

  it('collects every problem rather than stopping at the first', () => {
    const found = errors([
      { ...VALID[0], title: '' },
      { ...VALID[1], criteria: { kind: 'streak', days: -1 } },
    ]);

    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  it('names the offending entry in the path', () => {
    expect(errors([VALID[0], { ...VALID[1], title: '' }]).join()).toMatch(/\[1\]|streak-7/);
  });

  it('rejects anything that is not an array', () => {
    expect(errors({ 'spots-100': VALID[0] }).join()).toMatch(/array/);
  });
});

describe('evaluateAchievements', () => {
  const defs = ok(VALID);

  it('unlocks nothing for a brand-new account', () => {
    expect(evaluateAchievements(defs, snapshot())).toEqual([]);
  });

  it('unlocks on reaching a spot count', () => {
    expect(evaluateAchievements(defs, snapshot({ spots: 100 }))).toContain('spots-100');
    expect(evaluateAchievements(defs, snapshot({ spots: 99 }))).not.toContain('spots-100');
  });

  it('unlocks on reaching a streak', () => {
    expect(evaluateAchievements(defs, snapshot({ streak: 7 }))).toContain('streak-7');
    expect(evaluateAchievements(defs, snapshot({ streak: 6 }))).not.toContain('streak-7');
  });

  it('unlocks on completing lessons', () => {
    expect(evaluateAchievements(defs, snapshot({ lessonsCompleted: 1 }))).toContain('lessons-1');
  });

  it('unlocks mastery on any one skill that clears both bars', () => {
    const earned = evaluateAchievements(defs, snapshot({ stats: [stat('preflop.rfi.btn', 0.95, 40)] }));
    expect(earned).toContain('mastery-90');
  });

  /**
   * Both bars, not either. A tag at 100% over four answers is a good run, and
   * calling it mastery would hand out the badge on the strength of noise —
   * the same sample-size trap weak-spot detection avoids from the other side.
   */
  it('does not unlock mastery on a small sample, however clean', () => {
    const earned = evaluateAchievements(defs, snapshot({ stats: [stat('preflop.rfi.btn', 1, 4)] }));
    expect(earned).not.toContain('mastery-90');
  });

  it('does not unlock mastery on a large sample below the bar', () => {
    const earned = evaluateAchievements(defs, snapshot({ stats: [stat('preflop.rfi.btn', 0.85, 400)] }));
    expect(earned).not.toContain('mastery-90');
  });

  it('unlocks everything that is due at once', () => {
    const earned = evaluateAchievements(
      defs,
      snapshot({ spots: 500, streak: 30, lessonsCompleted: 10, stats: [stat('preflop.rfi.btn', 1, 99)] }),
    );

    expect([...earned].sort()).toEqual(['lessons-1', 'mastery-90', 'spots-100', 'streak-7']);
  });

  it('returns ids in a stable order', () => {
    const full = snapshot({ spots: 500, streak: 30, lessonsCompleted: 10 });
    expect(evaluateAchievements(defs, full)).toEqual(evaluateAchievements(defs, full));
  });

  /**
   * Evaluation says what is *earned*, not what is *new*. Which of those are
   * already recorded is the database's business — `user_achievements` has a
   * composite primary key precisely so re-inserting one is a no-op.
   */
  it('reports every earned achievement, not only the freshly earned ones', () => {
    const earned = evaluateAchievements(defs, snapshot({ spots: 5_000 }));
    expect(earned).toContain('spots-100');
  });
});
