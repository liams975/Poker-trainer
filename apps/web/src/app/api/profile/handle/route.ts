import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

/**
 * Choosing a handle and joining or leaving the weekly board.
 *
 * A Route Handler rather than a Server Action, like every other write path here.
 *
 * This is the reader's own decision about their own visibility, so unlike
 * entitlement it is theirs to make — but the *shape* of it is not. The format
 * and uniqueness rules live in `0007` as constraints, and this handler
 * deliberately does not re-implement them: it lets the database refuse and
 * translates the refusal. A second copy of a validation rule is a rule that
 * will disagree with itself eventually.
 */

/** Mirrors `profiles_handle_format`. Used to *explain*, never as the gate. */
const HANDLE_HINT = 'three to twenty characters: lowercase letters, digits and underscores';

export async function PATCH(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (user === null) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  const { handle, optedIn } = body as { handle?: unknown; optedIn?: unknown };

  if (handle !== undefined && handle !== null && typeof handle !== 'string') {
    return NextResponse.json({ error: 'handle must be a string or null' }, { status: 400 });
  }
  if (optedIn !== undefined && typeof optedIn !== 'boolean') {
    return NextResponse.json({ error: 'optedIn must be a boolean' }, { status: 400 });
  }

  const supabase = await createClient();

  /**
   * No `.eq('id', user.id)`. The update policy on `profiles` is
   * `auth.uid() = id`, so RLS scopes this to the caller's own row — and naming
   * the id here would suggest the policy were optional.
   */
  const { data, error } = await supabase
    .from('profiles')
    .update({
      ...(handle === undefined ? {} : { handle: handle === '' ? null : handle }),
      ...(optedIn === undefined ? {} : { leaderboard_opted_in: optedIn }),
    })
    .select('handle, leaderboard_opted_in')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: explain(error.code, error.message) }, { status: 400 });
  }

  return NextResponse.json({
    handle: data?.handle ?? null,
    optedIn: data?.leaderboard_opted_in ?? false,
  });
}

/** Postgres error codes, turned into something a person can act on. */
function explain(code: string | undefined, message: string): string {
  if (code === '23505') return 'that handle is taken';

  if (code === '23514') {
    // Both checks in 0007 raise 23514; the message names which.
    return message.includes('opted_in_needs_handle')
      ? 'choose a handle before joining the board'
      : `a handle is ${HANDLE_HINT}`;
  }

  return message;
}
