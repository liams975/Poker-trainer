import type { BotHandClaim, RecordedBotHand, SeatProfiles } from './types';

/**
 * The browser half of the bot-play write path.
 *
 * Plain `fetch`, for the reason `lib/drills/client.ts` records: Server Actions
 * go through Next's router queue, which serialises them and silently drops
 * concurrent dispatches. A hand ends and the next one deals immediately, so the
 * same failure was available here.
 */

async function post<T>(url: string, body: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // Cookies carry the session; without this the route sees an anonymous
    // caller and returns 401 for a perfectly valid user.
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export interface StartBotSessionRequest {
  stackDepth: number;
  bigBlind: number;
  profiles: SeatProfiles;
}

export function startBotSession(input: StartBotSessionRequest): Promise<{ sessionId: string }> {
  return post('/api/bot/sessions', input);
}

/**
 * Posts the hand's *inputs*. The server replays and writes what it derives.
 *
 * Nothing downstream of the deal is sent — no board, no opponents' actions, no
 * result — so there is nothing in the payload for the server to have to believe.
 */
export function recordBotHand(claim: BotHandClaim): Promise<RecordedBotHand> {
  return post('/api/bot/hands', claim);
}

export function endBotSession(sessionId: string): Promise<{ ok: true }> {
  return post('/api/bot/sessions', { sessionId }, 'PATCH');
}
