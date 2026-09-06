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
