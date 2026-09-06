import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/dal';
import { recordBotHand } from '@/lib/bot/record';
import type { BotHandClaim } from '@/lib/bot/types';

/**
 * Recording one hand of bot play.
 *
 * `getCurrentUser()` rather than `requireUser()`: this is an API, so an absent
 * session is a 401 and not a redirect to a sign-in page no fetch will follow.
 * RLS is still the backstop underneath — `user_id` comes from the verified user
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
    return NextResponse.json(await recordBotHand(user.id, body as BotHandClaim));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'could not record the hand';

    /**
     * 409 for a hand that does not replay, 400 for one that is malformed.
     *
     * Worth separating. A malformed payload is a bug in the caller; a
     * well-formed one that will not reproduce means the browser and the server
     * disagree about what the engine does, which is a much more interesting
     * failure and should not be filed under "bad request".
     */
    const conflict = /replay|unused|not terminating|illegal|cannot |must be at least/i.test(message);

    return NextResponse.json({ error: message }, { status: conflict ? 409 : 400 });
  }
}
