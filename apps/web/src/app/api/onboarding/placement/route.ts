import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/dal';
import { computePlacement, skipPlacement } from '@/lib/lessons/record';

/**
 * Finishing onboarding.
 *
 * The request carries a session id, or a request to skip. It never carries a
 * placement: docs/01-architecture.md §3 allows client-computed values only
 * where they "never gate money or unlock content", and a placement decides how
 * much of the track opens. The outcome is derived server-side from the
 * `drill_attempts` rows the server graded during the diagnostic.
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

  const { sessionId, skip } = body as { sessionId?: unknown; skip?: unknown };

  try {
    if (skip === true) {
      await skipPlacement(user.id);
      return NextResponse.json({ ok: true });
    }

    if (typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId must be a string' }, { status: 400 });
    }

    return NextResponse.json(await computePlacement(user.id, sessionId));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'could not finish onboarding';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
