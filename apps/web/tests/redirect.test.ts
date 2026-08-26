import { describe, expect, it } from 'vitest';

import { DEFAULT_REDIRECT, safeNext } from '../src/lib/auth/redirect';

/**
 * The open-redirect sanitiser is the one piece of the auth surface that is
 * pure, so it is the one piece that can be tested exhaustively rather than
 * reasoned about. Everything hostile here is a real bypass technique.
 */
describe('safeNext', () => {
  it('passes an ordinary in-app path through untouched', () => {
    expect(safeNext('/dashboard')).toBe('/dashboard');
    expect(safeNext('/range-explorer?position=BTN')).toBe('/range-explorer?position=BTN');
    expect(safeNext('/a/b/c#section')).toBe('/a/b/c#section');
  });

  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['an empty string', ''],
  ])('falls back to the dashboard given %s', (_label, input) => {
    expect(safeNext(input)).toBe(DEFAULT_REDIRECT);
  });

  it.each([
    ['an absolute http URL', 'https://evil.example/login'],
    ['an absolute URL on our own scheme', 'http://evil.example'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash-relative URL', '/\\evil.example'],
    ['a double backslash', '\\\\evil.example'],
    ['a javascript: URL', 'javascript:alert(document.cookie)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['a bare relative path', 'dashboard'],
  ])('rejects %s', (_label, input) => {
    expect(safeNext(input)).toBe(DEFAULT_REDIRECT);
  });

  it.each([
    ['percent-encoded protocol-relative', '%2F%2Fevil.example'],
    ['percent-encoded backslash', '%2F%5Cevil.example'],
    ['an embedded tab', '/\t/evil.example'],
    ['an embedded newline', '/\n/evil.example'],
    ['an encoded tab', '/%09/evil.example'],
  ])('rejects %s, which a naive prefix check would let through', (_label, input) => {
    expect(safeNext(input)).toBe(DEFAULT_REDIRECT);
  });

  it('rejects a malformed percent-escape rather than throwing', () => {
    expect(() => safeNext('%E0%A4%A')).not.toThrow();
    expect(safeNext('%E0%A4%A')).toBe(DEFAULT_REDIRECT);
  });

  it('never returns something a browser would treat as off-origin', () => {
    // Property-ish sweep: whatever comes back must resolve to our own origin
    // when the browser parses it against the current page.
    const hostile = [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/%09/evil.example',
      '%2F%2Fevil.example',
      'javascript:alert(1)',
      '\\/evil.example',
      '/////evil.example',
    ];

    for (const input of hostile) {
      const resolved = new URL(safeNext(input), 'https://app.example');
      expect(resolved.origin).toBe('https://app.example');
    }
  });
});
