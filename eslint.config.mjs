import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Engine purity, enforced as a lint rule rather than a convention.
 *
 * `packages/engine` must run unchanged in a React Native JS runtime in v2
 * (docs/01-architecture.md). An import restriction alone is not enough:
 * `window`, `document` and `process.env` are *globals*, not imports, and slip
 * past `no-restricted-imports` untouched. Hence three rules, not one.
 *
 * A second, independent gate lives in packages/engine/tsconfig.json, which
 * sets `lib: ["ES2022"]` and `types: []` so those globals are not even
 * declared. A violation therefore fails `pnpm typecheck` as well as `pnpm lint`.
 *
 * These rules apply to `src/**` only. Tests may use Node APIs — they never
 * ship to React Native.
 */
const ENGINE_PURITY_MESSAGE =
  'packages/engine must stay portable: no React, DOM, Node or env access. See docs/01-architecture.md.';

const RESTRICTED_NODE_BUILTINS = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dns', 'events',
  'fs', 'http', 'https', 'module', 'net', 'os', 'path', 'process', 'querystring',
  'readline', 'stream', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm',
  'worker_threads', 'zlib',
];

const RESTRICTED_GLOBALS = [
  'window', 'document', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest',
  'process', '__dirname', '__filename', 'require', 'Buffer',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/coverage/**',
      // Deliberate violations, linted programmatically by the purity test.
      '**/*.fixture.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    name: 'engine/purity',
    files: ['packages/engine/src/**/*.{ts,tsx,mts,cts}'],
    // S5: a boundary that "fails CI rather than relying on discipline"
    // (docs/01-architecture.md) must not have a one-line opt-out.
    linterOptions: { noInlineConfig: true },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'react-*'],
              message: ENGINE_PURITY_MESSAGE,
            },
            {
              group: ['next', 'next/*', '@next/*'],
              message: ENGINE_PURITY_MESSAGE,
            },
            {
              group: ['node:*'],
              message: ENGINE_PURITY_MESSAGE,
            },
            {
              group: RESTRICTED_NODE_BUILTINS,
              message: ENGINE_PURITY_MESSAGE,
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...RESTRICTED_GLOBALS.map((name) => ({ name, message: ENGINE_PURITY_MESSAGE })),
      ],
    },
  },

  /**
   * The web app's two security invariants, enforced rather than documented.
   *
   * Both of these are the kind of mistake that produces working, plausible,
   * reviewable code that is nonetheless an authentication bypass or a leaked
   * credential. A comment saying "don't" is not a control.
   */
  {
    name: 'web/auth-invariants',
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/lib/supabase/client.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          // Not a blanket ban: lib/supabase/env.ts reads the two NEXT_PUBLIC_
          // values and is where the exception is argued. Everything else in
          // the app goes through it, which is what keeps the service role key
          // — and any future server secret — out of a client bundle.
          message:
            'Read Supabase config through @/lib/supabase/env. SUPABASE_SERVICE_ROLE_KEY bypasses RLS and must never be reachable from apps/web.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          // getSession() decodes the auth cookie without verifying its
          // signature, so a forged cookie yields a "session". Safe in the
          // browser (where the user can only lie to themselves), an auth
          // bypass anywhere on the server. Hence the file-level exemption
          // above for the browser client rather than a blanket allowance.
          selector: "CallExpression > MemberExpression[property.name='getSession']",
          message:
            'getSession() does not verify the JWT. Use getCurrentUser()/requireUser() from @/lib/auth/dal, which calls getUser().',
        },
      ],
    },
  },

  {
    name: 'web/react',
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // docs/05's quality floor is an exit criterion, not a polish item:
      // "Visible keyboard focus on every interactive element. Full keyboard
      // navigation." These rules catch the structural half of that.
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },

  {
    /**
     * shadcn/ui primitives pass children through `{...props}` rather than
     * naming them, and `heading-has-content` is a syntactic check that cannot
     * see through the spread — so `<CardTitle>Dashboard</CardTitle>` reads as
     * an empty `<h3>` to it.
     *
     * Narrowed to the primitives directory on purpose: an actually-empty
     * heading in a page or feature component is a real accessibility bug and
     * still fails there.
     */
    name: 'web/ui-primitives',
    files: ['apps/web/src/components/ui/**/*.tsx'],
    rules: { 'jsx-a11y/heading-has-content': 'off' },
  },

  {
    // The env.ts exemption. Isolating each read into one named file is the
    // whole mechanism by which the rule above is enforceable at all — so a
    // second reader gets a second file, not an exception at a call site.
    name: 'web/env-reader',
    files: ['apps/web/src/lib/*/env.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },

  {
    // Import and global restrictions above are src-only: tests legitimately use
    // Node APIs and never ship to React Native. The seeded-RNG rule is not —
    // docs/03-poker-engine.md says "no bare Math.random() anywhere in the
    // package", and an irreproducible test is the exact risk it guards against.
    name: 'engine/seeded-rng',
    files: ['packages/engine/**/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded RNG from engine/rng. Bare Math.random() makes drills irreproducible.',
        },
      ],
    },
  },
);
