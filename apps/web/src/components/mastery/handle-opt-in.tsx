'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Joining the weekly board, or leaving it.
 *
 * Off by default and reversible from here, because the board is the only place
 * in this product where one reader's figures are visible to another. The copy
 * says exactly what becomes visible rather than gesturing at "sharing" — a
 * consent control that is vague about what it consents to is not consent.
 *
 * Validation is the database's (`0007`). This shows what comes back rather than
 * guessing ahead of it, so the two can never disagree about what a valid handle
 * is.
 */
export function HandleOptIn({
  handle: initialHandle,
  optedIn: initialOptedIn,
}: {
  handle: string | null;
  optedIn: boolean;
}) {
  const router = useRouter();
  const [handle, setHandle] = useState(initialHandle ?? '');
  const [optedIn, setOptedIn] = useState(initialOptedIn);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(next: { handle?: string; optedIn?: boolean }): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/profile/handle', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      const body = (await response.json()) as {
        handle?: string | null;
        optedIn?: boolean;
        error?: string;
      };

      if (!response.ok) {
        setError(body.error ?? 'could not save that');
        return;
      }

      setHandle(body.handle ?? '');
      setOptedIn(body.optedIn ?? false);
      // The board itself is server-rendered, so it has to be asked again.
      router.refresh();
    } catch {
      setError('could not reach the server');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-[var(--radius)] border border-line p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save({ handle });
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="handle" className="text-sm">
          Your handle on the board
        </label>
        <p className="text-xs text-ink-muted">
          {optedIn
            ? 'Other players can see this name, your EV lost per spot this week, and how many spots you played. Nothing else.'
            : 'You are not on the board. Nobody can see your figures.'}
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <Input
          id="handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder="gutshot_gary"
          className="max-w-64"
          aria-describedby={error ? 'handle-error' : undefined}
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" variant="outline" disabled={saving}>
          Save
        </Button>
        <Button
          type="button"
          variant={optedIn ? 'ghost' : 'default'}
          disabled={saving || (!optedIn && handle.trim() === '')}
          onClick={() => void save({ optedIn: !optedIn })}
        >
          {optedIn ? 'Leave the board' : 'Join the board'}
        </Button>
      </div>

      {error ? (
        <p id="handle-error" role="alert" className="text-xs text-action-raise">
          {error}
        </p>
      ) : null}
    </form>
  );
}
