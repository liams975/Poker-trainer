/**
 * Sanitises a post-authentication redirect target.
 *
 * `/sign-in?next=https://evil.example/login` is a credible phishing primitive:
 * the user sees a real sign-in on the real domain, and lands on an attacker's
 * page still believing they are in the app. Every auth flow in this codebase
 * routes its destination through here.
 *
 * Allowed: a path beginning with a single `/`, i.e. same-origin and absolute.
 *
 * Rejected, all of which browsers resolve off-origin:
 *   - `https://evil.example`        absolute URL
 *   - `//evil.example`              protocol-relative
 *   - `/\evil.example`              backslash; browsers normalise it to `//`
 *   - `javascript:` / `data:`       scheme injection
 *   - `/%09/evil.example`           tab, stripped during URL parsing
 *
 * Anything rejected falls back to `/dashboard` rather than throwing — a bad
 * `next` param should land you somewhere sensible, not on an error page.
 */
export const DEFAULT_REDIRECT = '/dashboard';

/** Tab, newline and carriage return: removed by browsers while parsing a URL. */
const URL_STRIPPED_CHARS = /[\t\n\r]/g;

export function safeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_REDIRECT;

  // Percent-encoding is how `%2F%2Fevil.example` gets past a naive prefix
  // check, so decode before inspecting. A malformed escape is itself hostile
  // input, so treat a throw as a rejection.
  let candidate: string;
  try {
    candidate = decodeURIComponent(next);
  } catch {
    return DEFAULT_REDIRECT;
  }

  // Judge the form the browser will actually navigate to: `/\t/evil.example`
  // resolves off-origin despite not literally starting with `//`.
  candidate = candidate.replace(URL_STRIPPED_CHARS, '').trim();

  if (!candidate.startsWith('/')) return DEFAULT_REDIRECT;

  // The second character decides same-origin. Both `//` and `/\` leave it.
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return DEFAULT_REDIRECT;

  return candidate;
}
