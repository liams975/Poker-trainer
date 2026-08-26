import { describe, expect, it } from 'vitest';

import { isPublicPath } from '../src/lib/auth/routes';

/**
 * The point of this list being deny-by-default is that a route nobody thought
 * about is protected rather than open. These tests exist to catch someone
 * later "fixing" it into an allow-list.
 */
describe('isPublicPath', () => {
  it.each(['/', '/sign-in', '/sign-up', '/auth/callback', '/auth/confirm'])(
    'treats %s as public',
    (path) => {
      expect(isPublicPath(path)).toBe(true);
    },
  );

  it.each([
    '/dashboard',
    '/range-explorer',
    '/drill/quick',
    '/settings',
    // Phases 6-11 have not been written yet. They must be protected anyway.
    '/some-route-that-does-not-exist-yet',
  ])('treats %s as protected', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });

  it('does not let a prefix match leak a protected route', () => {
    // `/sign-in-somewhere-else` shares a prefix with `/sign-in` but is not it.
    expect(isPublicPath('/sign-inbox')).toBe(false);
    expect(isPublicPath('/authenticate')).toBe(false);
  });
});
