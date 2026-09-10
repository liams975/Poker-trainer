import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The one rule Phase 12a must not break: **the heuristic never grades anybody.**
 *
 * `heuristics.ts` refused to ship a decision-making strategy in Phase 3 because
 * "a crude postflop strategy would be able to *grade* a user, and grading
 * someone against invented postflop logic teaches wrong play". Phase 12a built
 * one anyway, for the bot — and the whole justification for doing so is that it
 * stays on the bot's side of that line.
 *
 * A comment saying so is not a guarantee. These are.
 *
 * Read as source rather than exercised, in the pattern
 * `apps/web/tests/review-queries.test.ts` established: what is being checked is
 * a property of *what the code is allowed to reach*, and an import that is
 * merely never called today is a violation waiting for someone to call it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../src');

function sourcesIn(directory: string): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourcesIn(path));
    else if (entry.name.endsWith('.ts')) found.push({ path, text: readFileSync(path, 'utf8') });
  }

  return found;
}

describe('the grading path cannot reach the heuristic', () => {
  it('drills never import the bot module', () => {
    /**
     * `drills/` builds and grades spots. It has no business knowing an opponent
     * exists, and the day it imports one is the day a drill could be graded
     * against a sampled bot action instead of against a chart.
     */
    for (const file of sourcesIn(join(src, 'drills'))) {
      expect(file.text, `${file.path} imports the bot module`).not.toMatch(
        /from '\.\.\/bot/,
      );
    }
  });

  it('drills never import a heuristic or composite strategy', () => {
    for (const file of sourcesIn(join(src, 'drills'))) {
      for (const banned of ['createHeuristicStrategy', 'createBotStrategy', 'HEURISTIC_VERSION']) {
        expect(file.text, `${file.path} reaches ${banned}`).not.toContain(banned);
      }
    }
  });

  it('grading takes frequencies, never a strategy', () => {
    /**
     * `gradeAnswer` is handed a distribution and never asked where it came
     * from. That is what makes the isolation above sufficient: there is no
     * argument to `gradeAnswer` through which a heuristic could arrive, so
     * controlling who *constructs* one controls everything.
     */
    const grade = readFileSync(join(src, 'drills', 'grade.ts'), 'utf8');

    expect(grade).not.toContain('Strategy');
    expect(grade).not.toContain('recommend(');
  });

  it('the heuristic marks itself, and nothing else claims that mark', () => {
    // If a heuristic recommendation ever reaches `drill_attempts.chart_version`
    // it must be obvious in the data rather than look like a real chart set.
    //
    // A trailing number is allowed and a dated one is not. The guard's intent is
    // "never mistakable for a chart set", not "never changes": 12c retuned the
    // heuristic, and `bot_hands.heuristic_version` exists precisely so old rows
    // stay interpretable by the version that played them. A constant that could
    // never move would have made that column decorative.
    const heuristic = readFileSync(join(src, 'strategy', 'heuristic-strategy.ts'), 'utf8');
    expect(heuristic).toMatch(/HEURISTIC_VERSION\s*=\s*'heuristic(\.\d+)?'/);
    expect(
      heuristic,
      'a dated version would be indistinguishable from a chart set',
    ).not.toMatch(/HEURISTIC_VERSION\s*=\s*'[^']*\d{4}[.-]\d{2}/);

    const chart = readFileSync(join(src, 'strategy', 'chart-strategy.ts'), 'utf8');
    expect(chart, 'the chart strategy must never label itself a heuristic').not.toContain(
      'HEURISTIC_VERSION',
    );
    expect(chart).toContain("source: 'chart'");
  });

  it('hand review grades from a chart or not at all', () => {
    /**
     * 12b's addition, and the first thing in the engine that grades a human
     * inside a hand the bot is also playing. It reaches `chartRecommendation`
     * and `gradeAnswer` and nothing else — which is what makes "uncharted" a
     * reported reason rather than a silent handoff to the heuristic.
     *
     * The `drills/` sweeps above already forbid it the bot module and the
     * heuristic constructors. This pins the positive half: it does ask a chart.
     */
    const review = readFileSync(join(src, 'drills', 'hand-review.ts'), 'utf8');

    expect(review).toContain('chartRecommendation');
    expect(review, 'an uncharted spot must carry a reason, never a tier').toMatch(
      /uncharted: 'no-chart'/,
    );
    expect(review).toMatch(/uncharted: 'postflop'/);
  });

  it('the composite prefers the chart, and says so in one place', () => {
    /**
     * The ordering is load-bearing and it is one expression. Asserted on the
     * source because the behavioural test — `bot-strategy.test.ts` — can only
     * check the spots it thought to construct, while this checks that there is
     * no second code path where the preference could be reversed.
     */
    const composite = readFileSync(join(src, 'strategy', 'composite.ts'), 'utf8');

    expect(composite).toMatch(/chartRecommendation\([^)]*\)\s*\?\?\s*heuristic\.recommend/);
    // Never the other way round.
    expect(composite).not.toMatch(/heuristic\.recommend\([^)]*\)\s*\?\?/);
  });
});
