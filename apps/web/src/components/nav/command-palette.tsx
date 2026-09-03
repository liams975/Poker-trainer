'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { track } from '@/lib/analytics/client';

import { filterDestinations, type Destination } from './destinations';

/**
 * ⌘K.
 *
 * `docs/05-ui-ux.md` names this as one of four things a desktop app can do that
 * a phone cannot, and Phase 7 deferred it here for want of destinations. There
 * are now eleven.
 *
 * **No `cmdk` dependency.** The usual reach, and for eleven static entries it
 * would be more code to configure than to write — this repo already owns its
 * keyboard layer, and CLAUDE.md asks for a reason before a dependency rather
 * than after.
 *
 * Two collisions to be careful about, both already handled by
 * `components/drill/shortcuts.ts`:
 *
 *   - **⌘K while a drill is running** must open the palette, not fold. The
 *     runner's handler starts with `isShortcutTarget`, which refuses any
 *     modifier chord, so it never sees this.
 *   - **`f` while the palette is open** must type a letter, not answer the
 *     spot. The same guard refuses events whose target is an `INPUT`, and the
 *     search box is one.
 *
 * Neither needed new code, which is the payoff for having put that guard in a
 * shared module in Phase 7.
 */
export function CommandPalette({ destinations }: { destinations: readonly Destination[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => filterDestinations(destinations, query),
    [destinations, query],
  );

  // Derived here rather than just before the render, because the effect below
  // needs it. The list shrinks as you type, and an active index pointing past
  // the end would make Enter do nothing with a visible list on screen.
  const clamped = Math.min(active, Math.max(0, matches.length - 1));

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
  }, []);

  const go = useCallback(
    (destination: Destination | undefined) => {
      if (destination === undefined) return;
      close();
      router.push(destination.href);
    },
    [close, router],
  );

  /**
   * Opening is global; everything else is handled on the input below, so the
   * palette never listens for keys it does not own.
   *
   * `open` is a dependency rather than the listener using a functional update,
   * because the analytics call has to happen exactly once per open. A state
   * updater is not the place for a side effect — React is free to call it twice
   * in development, which would double-count the event and make local numbers
   * disagree with production for no visible reason. Re-registering one listener
   * on toggle is cheaper than that class of bug.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!open) track('palette_opened');
        setOpen(!open);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /**
   * Keeps the active option on screen.
   *
   * Focus stays in the input and only `aria-activedescendant` moves, so the
   * browser does nothing on its own — arrowing past the eighth entry moved the
   * highlight below the fold and the list sat still. axe found the scrollable
   * region; this is the bug behind it.
   */
  useEffect(() => {
    if (!open) return;
    const option = document.getElementById(`cmd-${matches[clamped]?.id ?? ''}`);
    option?.scrollIntoView({ block: 'nearest' });
  }, [open, matches, clamped]);

  if (!open) return null;

  let lastSection: string | null = null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/80 p-6 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Jump to"
    >
      {/* A real button, not a div with an onClick.
          Click-outside-to-close is expected of a palette, but a click handler
          on the backdrop div is a mouse-only affordance that jsx-a11y rightly
          refuses. A button is keyboard-reachable and announces itself, and
          Escape on the input closes it too — so there are two ways out and
          neither of them requires a pointer. */}
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default"
      />

      <div className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius)] border border-line bg-surface">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, matches.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              go(matches[clamped]);
            }
          }}
          placeholder="Jump to…"
          aria-label="Jump to"
          aria-controls="command-palette-list"
          aria-activedescendant={matches[clamped] ? `cmd-${matches[clamped].id}` : undefined}
          className="border-b border-line bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-muted"
          data-testid="command-input"
        />

        {/*
          A listbox, built the way ARIA actually defines one.
          The first version was `<ul role="listbox"> <li> <button role="option">`,
          which reads naturally and is wrong twice over: `role="listbox"`
          replaces the <ul>'s list semantics, so its <li> children are no longer
          in a list at all, and an `option` must be a direct child of the
          listbox or a `group` inside it — not wrapped in an <li>. axe caught
          both; the markup looked entirely reasonable until it did.

          Options are divs rather than buttons because they are not individually
          tabbable: focus stays in the input and `aria-activedescendant` points
          at the active one, which is the pattern that lets you type and choose
          in the same breath.
        */}
        <div
          id="command-palette-list"
          role="listbox"
          aria-label="Destinations"
          className="max-h-80 overflow-y-auto p-1"
          data-testid="command-list"
          // Focusable so the list can be scrolled by keyboard directly. It is
          // never focused in normal use — the input holds focus and points at
          // the active option — but a scrollable region only a mouse can reach
          // is a real trap for anyone who lands in it.
          tabIndex={0}
        >
          {matches.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">
              Nothing matches “{query}”.
            </p>
          ) : (
            matches.map((destination, index) => {
              const header = destination.section !== lastSection ? destination.section : null;
              lastSection = destination.section;

              return (
                <div key={destination.id} role="group" aria-label={destination.section}>
                  {header ? (
                    // aria-hidden: the group's own label already announces the
                    // section, and reading it twice is worse than not styling it.
                    <p
                      aria-hidden="true"
                      className="px-3 pb-1 pt-3 text-xs uppercase tracking-wider text-ink-muted"
                    >
                      {header}
                    </p>
                  ) : null}
                  <div
                    id={`cmd-${destination.id}`}
                    role="option"
                    aria-selected={index === clamped}
                    // Programmatically focusable, never in the tab order. An
                    // `option` under `aria-activedescendant` is pointed at, not
                    // tabbed to — eleven extra tab stops between the input and
                    // the page would defeat the point of a palette.
                    tabIndex={-1}
                    onClick={() => go(destination)}
                    onKeyDown={(event) => {
                      // Unreachable in practice, since focus stays in the input.
                      // Present because an option is an interactive control and
                      // one that only answers a mouse is not one.
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        go(destination);
                      }
                    }}
                    onMouseEnter={() => setActive(index)}
                    className={`cursor-pointer rounded-[calc(var(--radius)-2px)] px-3 py-2 text-sm ${
                      index === clamped ? 'bg-surface-raised text-ink' : 'text-ink-muted'
                    }`}
                  >
                    {destination.label}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
