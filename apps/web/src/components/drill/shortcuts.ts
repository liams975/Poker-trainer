import type { Action, LegalAction } from '@poker/engine';

/**
 * The keyboard map, defined once.
 *
 * docs/05-ui-ux.md: "A user should be able to run a 50-spot session without
 * touching the mouse. This is what makes the app feel like a serious tool and
 * lets drill velocity go up several-fold." The roadmap makes it an exit
 * criterion, not a nicety.
 *
 * Both the key handler and the `?` overlay read this list, so the shortcuts the
 * app documents cannot drift from the ones it actually honours — which is the
 * usual way a keyboard interface rots.
 */
export interface Shortcut {
  keys: readonly string[];
  description: string;
}

/**
 * `C` is unambiguous despite covering two actions: `check` is legal only when
 * there is nothing to call and `call` only when there is, so they never appear
 * together in `legalActions`. One key for "don't fold, don't raise" matches how
 * players actually think about the decision.
 */
export const ACTION_KEYS: Readonly<Record<string, readonly Action[]>> = {
  f: ['fold'],
  c: ['check', 'call'],
  r: ['raise', 'bet'],
  a: ['allin'],
};

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['F'], description: 'Fold' },
  { keys: ['C'], description: 'Check or call, whichever is legal' },
  { keys: ['R'], description: 'Raise or bet' },
  { keys: ['A'], description: 'All in' },
  { keys: ['1', '…', '9'], description: 'Pick a raise size, when more than one is offered' },
  { keys: ['Enter'], description: 'Submit the selected action' },
  { keys: ['Space'], description: 'Next spot, once the answer is revealed' },
  { keys: ['?'], description: 'Show these shortcuts' },
  { keys: ['Esc'], description: 'Close this panel' },
];

/** Which legal action a letter selects, or undefined if that key does nothing here. */
export function actionForKey(
  key: string,
  legal: readonly LegalAction[],
): LegalAction | undefined {
  const candidates = ACTION_KEYS[key.toLowerCase()];
  if (candidates === undefined) return undefined;

  return legal.find((option) => candidates.includes(option.action));
}

/**
 * Whether a keystroke should be treated as a shortcut at all.
 *
 * A drill has no text inputs today, but the session config screen does, and a
 * global handler that swallows `f` inside a filter box is the classic way this
 * goes wrong. Modifier chords are left alone so browser and OS shortcuts keep
 * working.
 */
export function isShortcutTarget(event: {
  target: EventTarget | null;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;

  const target = event.target;
  if (target === null || !(target instanceof HTMLElement)) return true;

  if (target.isContentEditable) return false;
  return !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
