'use client';

import type { Action, HandState, LegalAction, Position } from '@poker/engine';
import { amountToCall } from '@poker/engine';

import { actionStyle } from '@/components/range/action-colors';
import { cn } from '@/lib/utils';

/**
 * Hero's decision.
 *
 * Every option is one keystroke away and submits on press — no select-then-
 * confirm step. docs/05-ui-ux.md wants a 50-spot session runnable without the
 * mouse, and a two-step commit doubles the keystrokes for the one interaction
 * the whole session repeats.
 *
 * Keys carry the action hue as a stripe so the answer and the frequency bar
 * that follows speak the same visual language, and each also carries its glyph
 * and full label — CLAUDE.md: never use colour alone to encode a strategy
 * action.
 */
export interface Choice {
  action: Action;
  size?: number;
  label: string;
  /** The key that triggers it, shown on the button. */
  hint: string;
}

/**
 * Builds the offered choices from what is *legal*, and the sizes from the chart
 * family rather than hero's own chart — see `raiseSizeOptions` in the engine
 * for why offering the chart's single size would hand over the answer.
 */
export function buildChoices(
  legal: readonly LegalAction[],
  sizeOptions: readonly number[],
): readonly Choice[] {
  const choices: Choice[] = [];

  for (const option of legal) {
    if (option.action === 'fold') {
      choices.push({ action: 'fold', label: 'Fold', hint: 'F' });
    } else if (option.action === 'check') {
      choices.push({ action: 'check', label: 'Check', hint: 'C' });
    } else if (option.action === 'call') {
      choices.push({ action: 'call', label: 'Call', hint: 'C' });
    }
  }

  const aggressive = legal.find((o) => o.action === 'raise' || o.action === 'bet');
  if (aggressive !== undefined) {
    const usable = sizeOptions.filter(
      (size) =>
        (aggressive.minTo === undefined || size >= aggressive.minTo) &&
        (aggressive.maxTo === undefined || size <= aggressive.maxTo),
    );

    usable.forEach((size, index) => {
      choices.push({
        action: aggressive.action,
        size,
        label: `${aggressive.action === 'bet' ? 'Bet' : 'Raise'} to ${size}bb`,
        // R for the first, then number keys — so the common case is one key and
        // the alternatives are still reachable without the mouse.
        hint: index === 0 ? 'R' : String(index + 1),
      });
    });
  }

  if (legal.some((o) => o.action === 'allin')) {
    choices.push({ action: 'allin', label: 'All in', hint: 'A' });
  }

  return choices;
}

export interface DecisionControlsProps {
  state: HandState;
  hero: Position;
  choices: readonly Choice[];
  onAnswer: (choice: Choice) => void;
  disabled?: boolean;
  /**
   * The choice already made, once the spot is answered. Drawn pressed, so the
   * keypad beside the solution still says what you did.
   */
  chosen?: Pick<Choice, 'action' | 'size'> | undefined;
}

/** The word on the key's top line and the figure under it. */
function keyFace(choice: Choice, toCall: number): { verb: string; figure: string | null } {
  switch (choice.action) {
    case 'fold':
      return { verb: 'Fold', figure: null };
    case 'check':
      return { verb: 'Check', figure: null };
    case 'call':
      return { verb: 'Call', figure: String(toCall) };
    case 'bet':
    case 'raise':
      return {
        verb: choice.action === 'bet' ? 'Bet' : 'Raise to',
        figure: choice.size === undefined ? null : String(choice.size),
      };
    case 'allin':
      return { verb: 'All in', figure: null };
  }
}

/**
 * The keypad, after the Braun ET66.
 *
 * Dark keys, each wearing its action as a stripe along the bottom edge, the way
 * the ET66 colour-codes its function keys — and each also carrying the glyph,
 * the word and the key letter, so the hue is never the only encoding
 * (CLAUDE.md). Three rows, passive to aggressive, which is the same left-to-
 * right order every grid cell uses.
 *
 * The DOM order is exactly `choices`' order; the rows only group it.
 */
export function DecisionControls({
  state,
  hero,
  choices,
  onAnswer,
  disabled = false,
  chosen,
}: DecisionControlsProps) {
  const toCall = amountToCall(state, hero);

  const rows = [
    choices.filter((c) => c.action === 'fold' || c.action === 'check' || c.action === 'call'),
    choices.filter((c) => c.action === 'bet' || c.action === 'raise'),
    choices.filter((c) => c.action === 'allin'),
  ].filter((row) => row.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="label-caps text-ink">
        Your action{toCall > 0 ? ` — ${toCall}bb to call` : ''}
      </h3>

      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div
            key={row[0]!.action}
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${Math.max(row.length, 2)}, minmax(0, 1fr))` }}
          >
            {row.map((choice) => {
              const style = actionStyle(choice.action);
              const face = keyFace(choice, toCall);
              const pressed =
                chosen !== undefined &&
                chosen.action === choice.action &&
                chosen.size === choice.size;

              return (
                <button
                  key={`${choice.action}-${choice.size ?? ''}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => onAnswer(choice)}
                  aria-pressed={chosen === undefined ? undefined : pressed}
                  aria-keyshortcuts={choice.hint}
                  data-testid={`choice-${choice.action}${choice.size === undefined ? '' : `-${choice.size}`}`}
                  className={cn(
                    'relative flex min-w-0 flex-col gap-2 overflow-hidden border px-3.5 pb-4 pt-3 text-left transition-colors',
                    pressed
                      ? 'border-ink bg-ink text-canvas'
                      : 'border-line bg-surface-raised text-ink hover:border-ink',
                    // A key that was not pressed recedes once the spot is
                    // answered. Colour, not opacity, for the text — the same
                    // contrast rule the folded seats follow.
                    disabled && !pressed && 'text-ink-muted hover:border-line',
                  )}
                >
                  {/* The face is drawn for the eye and hidden from the reader:
                      verb, figure and key letter would otherwise be announced
                      beside the label that already says all three. */}
                  <span aria-hidden="true" className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'label-caps truncate',
                        pressed ? 'text-canvas' : 'text-ink-muted',
                      )}
                    >
                      <span style={{ color: style.hex }}>{style.glyph}</span> {face.verb}
                    </span>
                    <kbd
                      className={cn(
                        'border px-1.5 py-0.5 font-mono text-2xs leading-none',
                        pressed ? 'border-canvas/40 text-canvas' : 'border-line text-ink-muted',
                      )}
                    >
                      {choice.hint}
                    </kbd>
                  </span>

                  <span
                    aria-hidden="true"
                    className="whitespace-nowrap font-display text-2xl leading-none"
                  >
                    {face.figure === null ? (
                      style.label
                    ) : (
                      <>
                        {face.figure}
                        <i
                          className={cn(
                            'ml-1 text-base',
                            pressed ? 'text-canvas' : 'text-ink-muted',
                          )}
                        >
                          bb
                        </i>
                      </>
                    )}
                  </span>
                  {/* The screen-reader label, in the words the keys always had. */}
                  <span className="sr-only">{choice.label}</span>

                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-1"
                    style={{ backgroundColor: style.hex }}
                  />
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
