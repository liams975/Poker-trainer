import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/dal';
import { recordAttempt, type RecordAttemptInput } from '@/lib/drills/record';

/**
 * Recording one graded attempt.
 *
 * A Route Handler rather than a Server Action, because a drill fires these
 * faster than a round trip completes and Next's action queue drops the
 * concurrent ones — silently, in the one table docs/04 makes every later
 * progress figure derive from. See lib/drills/record.ts.
 *
 * `getCurrentUser()` rather than `requireUser()`: this is an API, so an absent
 * session is a 401, not a redirect to a sign-in page no fetch will follow. RLS
 * is still the backstop underneath — `user_id` is taken from the verified user
 * here and the policy checks it again in Postgres.
 */
export async function POST(request: Request): Promise<NextResponse> {
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

  try {
    const recorded = await recordAttempt(user.id, body as RecordAttemptInput);
    return NextResponse.json(recorded);
  } catch (cause) {
    // Validation failures and contradictory scenarios are the caller's fault
    // and say so; `record.ts` throws with a message written to be shown.
    const message = cause instanceof Error ? cause.message : 'could not record the attempt';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
