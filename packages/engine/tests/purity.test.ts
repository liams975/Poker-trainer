import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Phase 0 exit criterion #2, from docs/02-roadmap.md:
 *
 *   "The engine import-restriction rule provably fails when you try to
 *    `import React` inside packages/engine."
 *
 * The rules live in eslint.config.mjs under the `engine/purity` block. This
 * test runs ESLint over deliberately-broken input and asserts the specific
 * rule IDs fire.
 *
 * Why lintText() and not lintFiles(): the fixtures must be ignored by the
 * normal `pnpm lint` run, or CI would fail on them. Ignored files cannot then
 * be linted back by path. Passing the fixture *text* under a `filePath` inside
 * packages/engine/src sidesteps that, and has the same effect — ESLint resolves
 * config by the path it is given.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

// A path that does not exist on disk, but matches the engine purity glob.
const ENGINE_SRC_PROBE = resolve(repoRoot, 'packages/engine/src/__purity_probe__.ts');

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: repoRoot });
});

async function lintAsEngineSource(code: string) {
  const results = await eslint.lintText(code, {
    filePath: ENGINE_SRC_PROBE,
    warnIgnored: false,
  });

  return results[0]?.messages ?? [];
}

async function loadFixture(name: string) {
  return readFile(resolve(here, 'fixtures', name), 'utf8');
}

function ruleIds(messages: Awaited<ReturnType<typeof lintAsEngineSource>>) {
  return messages.map((m) => m.ruleId);
}

describe('engine purity gate', () => {
  // Positive control. Without this, a harness that reported failure for *any*
  // input would look identical to a working one.
  it('reports nothing for clean engine source', async () => {
    const messages = await lintAsEngineSource(
      [
        'export interface Seeded {',
        '  next(): number;',
        '}',
        '',
        'export function double(n: number): number {',
        '  return n * 2;',
        '}',
        '',
      ].join('\n'),
    );

    expect(messages).toEqual([]);
  });

  // The exit criterion, stated literally.
  it('fails on `import React from "react"` — the roadmap exit criterion', async () => {
    const messages = await lintAsEngineSource(
      'import React from \'react\';\n\nexport const x = React;\n',
    );

    expect(ruleIds(messages)).toContain('@typescript-eslint/no-restricted-imports');
    expect(messages.some((m) => m.severity === 2)).toBe(true);
  });

  it('fails on type-only React imports', async () => {
    const messages = await lintAsEngineSource(
      'import type { ComponentType } from \'react\';\n\nexport type X = ComponentType;\n',
    );

    expect(ruleIds(messages)).toContain('@typescript-eslint/no-restricted-imports');
  });

  it.each([
    ['next/navigation', "import { useRouter } from 'next/navigation';\nexport const r = useRouter;\n"],
    ['node: builtins', "import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n"],
    ['bare builtins', "import { join } from 'path';\nexport const j = join;\n"],
  ])('fails on %s', async (_label, code) => {
    const messages = await lintAsEngineSource(code);

    expect(ruleIds(messages)).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('catches every violation in the restricted-imports fixture', async () => {
    const messages = await lintAsEngineSource(await loadFixture('restricted-imports.fixture.ts'));
    const restricted = messages.filter(
      (m) => m.ruleId === '@typescript-eslint/no-restricted-imports',
    );

    // react, react (type), next/navigation, node:fs, path
    expect(restricted.length).toBeGreaterThanOrEqual(5);
  });

  // The half an import rule cannot see.
  it.each([
    ['window', 'export const w = window.innerWidth;\n'],
    ['document', 'export const t = document.title;\n'],
    ['process', 'export const e = process.env.SECRET;\n'],
  ])('fails on the %s global, which is not an import', async (_label, code) => {
    const messages = await lintAsEngineSource(code);

    expect(ruleIds(messages)).toContain('no-restricted-globals');
  });

  it('fails on bare Math.random()', async () => {
    const messages = await lintAsEngineSource('export const r = Math.random();\n');

    expect(ruleIds(messages)).toContain('no-restricted-properties');
  });

  it('catches every violation in the restricted-globals fixture', async () => {
    const messages = await lintAsEngineSource(await loadFixture('restricted-globals.fixture.ts'));
    const ids = ruleIds(messages);

    expect(ids).toContain('no-restricted-globals');
    expect(ids).toContain('no-restricted-properties');
  });

  // The restriction is scoped to the engine on purpose: the rest of the
  // workspace is allowed to use React, Node and the DOM.
  it('does not restrict code outside packages/engine/src', async () => {
    const results = await eslint.lintText('export const w = window.innerWidth;\n', {
      filePath: resolve(repoRoot, 'apps/web/src/probe.ts'),
      warnIgnored: false,
    });

    const messages = results[0]?.messages ?? [];

    // Positive control for this negative assertion: the probe path must
    // actually be linted, or "no error" would prove nothing.
    expect(results).toHaveLength(1);
    expect(ruleIds(messages)).not.toContain('no-restricted-globals');
  });

  // --- Regression tests: holes found by the Phase 0 exit review ---

  // The glob was `src/**/*.ts`, so a .mts/.cts/.tsx file in the engine was
  // linted by the general config but skipped by the purity block entirely.
  it.each(['ts', 'tsx', 'mts', 'cts'])(
    'applies the purity rules to .%s files, not just .ts',
    async (ext) => {
      const results = await eslint.lintText("import React from 'react';\nexport const x = React;\n", {
        filePath: resolve(repoRoot, `packages/engine/src/probe.${ext}`),
        warnIgnored: false,
      });

      expect(ruleIds(results[0]?.messages ?? [])).toContain(
        '@typescript-eslint/no-restricted-imports',
      );
    },
  );

  // A gate with a one-line opt-out is a convention, not a gate.
  it('cannot be switched off with an inline eslint-disable', async () => {
    const messages = await lintAsEngineSource(
      "/* eslint-disable */\nimport React from 'react';\nexport const x = React;\n",
    );

    expect(ruleIds(messages)).toContain('@typescript-eslint/no-restricted-imports');
  });

  // docs/03: "no bare Math.random() anywhere in the package" — tests included.
  // Tests are where it actually tempts, and a flaky engine test is the risk.
  it('bans bare Math.random() in engine tests, not only in src', async () => {
    const results = await eslint.lintText('export const r = Math.random();\n', {
      filePath: resolve(repoRoot, 'packages/engine/tests/probe.test.ts'),
      warnIgnored: false,
    });

    expect(ruleIds(results[0]?.messages ?? [])).toContain('no-restricted-properties');
  });
});
