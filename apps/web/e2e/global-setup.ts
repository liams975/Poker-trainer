/**
 * Prove the server on the port is **this** app, before a single test runs.
 *
 * `reuseExistingServer: !CI` is a real convenience — a developer with `pnpm dev`
 * already running should not wait for a second server — but on its own it only
 * asks "is something answering on port 3000?". Port 3000 is the Next default,
 * so the honest answer is often "yes, somebody else's app".
 *
 * That is not hypothetical. Phase 13 ran the full suite against
 * `second-brain/dashboard`, a Next 14 app that had taken the port two minutes
 * earlier: **two hours**, 6 passed, and every failure looked like a real
 * regression in auth and routing. The suite cannot tell you it tested the wrong
 * application, so it has to refuse to start against one.
 *
 * Set `E2E_PORT` to run somewhere else when the default is taken.
 */

const MARKER = 'Poker Trainer';

export default async function globalSetup(): Promise<void> {
  const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

  let response: Response;
  try {
    response = await fetch(base, { signal: AbortSignal.timeout(30_000) });
  } catch (cause) {
    throw new Error(`nothing answered at ${base}, so there is no app to test`, { cause });
  }

  if (!response.ok) {
    throw new Error(`${base} answered ${response.status}; the app is not serving`);
  }

  const body = await response.text();
  if (!body.includes(MARKER)) {
    /**
     * Deliberately loud, and deliberately naming the fix. The failure this
     * replaces cost two hours and read as a product bug the whole way.
     */
    throw new Error(
      `${base} is serving something, but it is not this app — no "${MARKER}" in the response.\n` +
        `Another project is probably holding the port. Stop it, or run the suite elsewhere:\n` +
        `    E2E_PORT=3100 pnpm test:e2e`,
    );
  }
}
