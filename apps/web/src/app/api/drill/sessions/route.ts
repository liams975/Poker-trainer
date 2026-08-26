import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/dal';
import { finishSession, startSession, type StartSessionInput } from '@/lib/drills/record';

/**
 * Opening and closing a drill session.
 *
 * Route Handlers for the same reason attempts are — one write path, one set of
 * rules, rather than two mechanisms with different failure modes.
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
    return NextResponse.json(await startSession(user.id, body as StartSessionInput));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'could not start the session';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

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

  const sessionId = (body as { sessionId?: unknown }).sessionId;
  if (typeof sessionId !== 'string') {
    return NextResponse.json({ error: 'sessionId must be a string' }, { status: 400 });
  }

  try {
    // No ownership check here beyond RLS, which is the point of RLS: the update
    // simply matches no rows for a session the caller does not own.
    await finishSession(sessionId);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'could not close the session';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
