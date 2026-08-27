import type { LessonStatus, TagEvidence } from '@poker/engine';

/**
 * The browser half of the lesson write path.
 *
 * Plain `fetch` to Route Handlers, for the reason Phase 7 documented: Next
 * serialises Server Actions through the router queue and drops concurrent
 * dispatches, which silently lost about half of every drill session's attempts
 * before it was caught.
 */

async function send<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export function setLessonStatus(
  lessonSlug: string,
  status: LessonStatus,
): Promise<{ lessonSlug: string; status: LessonStatus }> {
  return send('/api/lessons/progress', { lessonSlug, status });
}

export interface PlacementOutcome {
  skillTag: string | null;
  byTag: readonly TagEvidence[];
  startLessonSlug: string | null;
}

/**
 * Asks the server to grade a finished diagnostic.
 *
 * Only the session id goes up. The outcome is derived server-side from the
 * attempts it graded itself — the browser cannot post a placement, because a
 * placement unlocks content.
 */
export function submitPlacement(sessionId: string): Promise<PlacementOutcome> {
  return send('/api/onboarding/placement', { sessionId });
}

export function skipPlacement(): Promise<{ ok: true }> {
  return send('/api/onboarding/placement', { skip: true });
}
