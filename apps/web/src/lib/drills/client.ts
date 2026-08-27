import type { Action, DrillScenario, Grade, GradeTier, Rationale } from '@poker/engine';

import type { SessionRewards } from '@/lib/progress/record';

/**
 * The browser half of the drill write path.
 *
 * Plain `fetch`, deliberately. Server Actions go through Next's router queue,
 * which serialises them and drops concurrent dispatches — a drill answers
 * faster than a round trip completes, so roughly half of every session's
 * attempts vanished with no error at all. `fetch` calls are independent, so
 * answering quickly no longer costs you your history.
 *
 * These wrappers exist so the runner never assembles a URL or a body itself,
 * and so the request shapes are declared next to each other rather than
 * inferred from two ends of a network call.
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

export interface StartSessionRequest {
  mode: 'quick' | 'focused' | 'weak_spots' | 'lesson' | 'study' | 'placement';
  seed: number;
  spotsPlanned: number | null;
  templateSlugs: readonly string[];
}

export function startSession(input: StartSessionRequest): Promise<{ sessionId: string }> {
  return post('/api/drill/sessions', input);
}

export interface RecordAttemptRequest {
  sessionId: string;
  templateId: string;
  scenario: DrillScenario;
  seed: number;
  action: Action;
  size?: number | undefined;
  responseMs: number;
  /** Compared server-side, never stored. A mismatch is a bug or a tampered payload. */
  clientTier?: GradeTier | undefined;
}

export interface RecordedAttempt {
  grade: Grade;
  frequencies: Grade['frequencies'];
  rationale: Rationale;
  chartVersion: string;
  skillTags: readonly string[];
}

export function recordAttempt(input: RecordAttemptRequest): Promise<RecordedAttempt> {
  return post('/api/drill/attempts', input);
}

/**
 * Closes the session and returns what it earned.
 *
 * `rewards` is null when there was nothing to pay for — a session already
 * closed, or one that recorded no answers. The summary treats that as "no
 * rewards to show" rather than as an error, because both cases are ordinary.
 */
export function finishSession(sessionId: string): Promise<{ ok: true; rewards: SessionRewards | null }> {
  return post('/api/drill/sessions', { sessionId }, 'PATCH');
}
