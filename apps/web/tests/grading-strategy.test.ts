import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The two places a user's answer is graded, and the strategy each is allowed to
 * build.
 *
 * Phase 12a added `createHeuristicStrategy` — invented postflop logic, written
 * to give a *bot* something to play. `heuristics.ts` had refused to ship one
 * since Phase 3 with an exact reason: "grading someone against invented
 * postflop logic teaches wrong play." Building it was justified entirely by it
 * staying on the bot's side of that line.
 *
 * `packages/engine/tests/grading-isolation.test.ts` holds the engine end —
 * `drills/` cannot reach the bot module at all. This holds the app end, which
 * is where the line is actually easy to cross: both files below already import
 * from `@poker/engine`, and swapping one identifier in the import list would
 * silently start grading every answer against a guess.
 *
 * docs/05-ui-ux.md, Phase 7: "Both run the same engine over the same charts."
 * That sentence is what these two assertions keep true.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/** Every place a user's answer becomes a grade. */
const GRADING_PATHS = [
  // The server's pass, which writes the row everything else is derived from.
  '../src/lib/drills/record.ts',
  // The browser's pass, which lands the tier without a spinner.
  '../src/components/drill/drill-runner.tsx',
] as const;

const BANNED = [
  'createHeuristicStrategy',
  'createBotStrategy',
  'HEURISTIC_VERSION',
  'sampleAction',
] as const;

describe('the grading path builds the chart strategy and nothing else', () => {
  for (const path of GRADING_PATHS) {
    const source = read(path);
    const name = path.split('/').pop();

    it(`${name} constructs createChartStrategy`, () => {
      // Non-vacuity. Without this, deleting the grading entirely would pass the
      // assertion below perfectly.
      expect(source).toContain('createChartStrategy');
    });

    it(`${name} never constructs a heuristic or a bot`, () => {
      for (const banned of BANNED) {
        expect(source, `${name} reaches ${banned}`).not.toContain(banned);
      }
    });
  }

  it('grades against the chart version the recommendation carried', () => {
    /**
     * The other half of the same rule. `chart_version` on a stored attempt is
     * what keeps history interpretable when a chart is retuned, and a row
     * written with `'heuristic'` in that column would be a graded answer with
     * no chart behind it.
     */
    const record = read('../src/lib/drills/record.ts');

    expect(record).toContain('chartVersion');
    expect(record).not.toContain("'heuristic'");
  });
});

/**
 * 12b puts the two on the same screen for the first time.
 *
 * Bot play *builds* `createBotStrategy` — that is the whole point of it — and
 * on the very same hand it grades hero's own preflop decisions. So the runner
 * is the one file in the app that legitimately holds both, and the separation
 * has to be asserted differently: not "never touches the bot" but "never grades
 * with it".
 */
describe('bot play grades through the review path, never through the bot', () => {
  /**
   * Comments stripped before checking, and the reason is not tidiness.
   *
   * These two files have to *explain* the rule — "grading against
   * `createHeuristicStrategy` is what this avoids" is the clearest sentence
   * available for it — and a raw-text guard reads that sentence as a violation.
   * The rule is about what the code can reach, so the check is over code. The
   * two grading paths above keep the raw-text form because neither discusses
   * the banned names, and a stricter guard that passes is worth keeping.
   */
  const withoutComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const runner = withoutComments(read('../src/components/play/bot-table-runner.tsx'));
  const summary = withoutComments(read('../src/components/play/hand-summary.tsx'));
  const summarySource = read('../src/components/play/hand-summary.tsx');

  it('grades hero through reviewHandDecisions', () => {
    // Non-vacuity, again: with the grading deleted the next assertion passes.
    expect(runner).toContain('reviewHandDecisions');
  });

  it('never grades an answer against a strategy of any kind', () => {
    /**
     * `reviewHandDecisions` lives in `drills/`, which the engine's own
     * isolation test forbids from importing `bot/` at all. So the guarantee
     * here is narrower and sufficient: whatever the runner constructs for the
     * *opponents*, the thing it grades with takes decision points and a chart
     * registry, and there is no argument through which a heuristic could
     * arrive.
     */
    expect(runner, 'the runner must not grade against a strategy').not.toContain('gradeAnswer');
    expect(runner).not.toContain('createChartStrategy');
    expect(runner).not.toContain('createHeuristicStrategy');

    // And the panel that renders the result only ever displays one.
    for (const banned of BANNED) {
      expect(summary, `hand-summary.ts reaches ${banned}`).not.toContain(banned);
    }
    expect(summary).not.toContain('gradeAnswer');
  });

  it('says out loud when a spot has no chart, rather than scoring it anyway', () => {
    /**
     * The visible half of the rule, and the reason it is worth a test: an
     * uncharted decision that silently grew a tier would look exactly like a
     * charted one, and would mean grading against the heuristic.
     */
    expect(summarySource).toContain('uncharted');
    expect(summarySource).toMatch(/No chart covers this spot yet/);
  });
});
