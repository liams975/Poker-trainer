'use client';

import { useEffect, useRef } from 'react';

import { SHORTCUTS } from './shortcuts';

/**
 * The `?` panel.
 *
 * An undiscoverable keyboard interface is one nobody learns, which would waste
 * the exit criterion it exists to serve. Rendered from the same `SHORTCUTS`
 * list the handler reads, so what is documented and what works cannot drift.
 */
export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus moves into the dialog when it opens, so a keyboard user is not left
  // behind on the page underneath with no way to read or dismiss it.
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-[var(--radius)] border border-line bg-surface p-6">
        <h2 className="font-display text-base font-semibold">Keyboard shortcuts</h2>

        <dl className="flex flex-col gap-2">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.description} className="flex items-baseline gap-3 text-sm">
              <dt className="flex w-28 shrink-0 gap-1">
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    className="rounded border border-line bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-ink"
                  >
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd className="text-ink-muted">{shortcut.description}</dd>
            </div>
          ))}
        </dl>

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="self-start rounded-[var(--radius)] border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-raised"
        >
          Close
        </button>
      </div>
    </div>
  );
}
