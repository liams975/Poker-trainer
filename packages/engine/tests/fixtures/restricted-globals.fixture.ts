// DELIBERATELY BROKEN. See restricted-imports.fixture.ts.
//
// These are the violations an import-only rule cannot see: globals, not
// imports. This fixture is why the purity gate is three rules rather than one.

export function violations() {
  const width = window.innerWidth;
  const title = document.title;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const notSeeded = Math.random();

  return { width, title, secret, notSeeded };
}
