import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/dal';
import { setLessonStatus, type SetLessonStatusInput } from '@/lib/lessons/record';

/**
 * Recording that a lesson was started or finished.
 *
 * `getCurrentUser()` rather than `requireUser()`: this is an API, so an absent
 * session is a 401 and not a redirect to a sign-in page no fetch will follow.
 * RLS is the backstop underneath — `user_id` comes from the verified user here
 * and the policy checks it again in Postgres.
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
    return NextResponse.json(await setLessonStatus(user.id, body as SetLessonStatusInput));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'could not save progress';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
