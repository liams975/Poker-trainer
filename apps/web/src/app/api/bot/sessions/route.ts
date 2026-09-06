import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/dal';
import { endBotSession, startBotSession, type StartBotSessionInput } from '@/lib/bot/record';

/** Opening and closing a sitting at the table. */
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
    return NextResponse.json(await startBotSession(user.id, body as StartBotSessionInput));
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
    // Nothing is paid out for a sitting in 12b — no XP, no streak — so closing
    // it only records that it ended. `.is('ended_at', null)` makes a retry a
    // no-op rather than moving the timestamp.
    await endBotSession(user.id, sessionId);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'could not close the session';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
