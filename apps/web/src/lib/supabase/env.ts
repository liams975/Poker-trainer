/**
 * The two public Supabase values, read in one place.
 *
 * Only `NEXT_PUBLIC_`-prefixed variables are readable from browser code, which
 * is the property that keeps `SUPABASE_SERVICE_ROLE_KEY` out of the bundle.
 * That key bypasses RLS entirely; it belongs in Edge Functions and the content
 * sync script, and nowhere under apps/web. A lint rule in eslint.config.mjs
 * enforces that rather than trusting this comment.
 *
 * Read through `process.env.NEXT_PUBLIC_X` literally, never
 * `process.env[name]` — Next inlines these at build time by matching the
 * literal text, so a computed lookup silently yields undefined in the browser.
 */
function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local, then run ` +
        '`supabase status -o env` and fill in what it prints.',
    );
  }

  return value;
}

export function supabaseUrl(): string {
  return required(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
}

export function supabaseAnonKey(): string {
  return required(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
}
