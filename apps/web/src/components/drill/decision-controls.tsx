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
 * Buttons carry the action hue so the answer and the frequency bar that follows
 * speak the same visual language, and each also carries its glyph and full
 * label — CLAUDE.md: never use colour alone to encode a strategy action.
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
}

export function DecisionControls({
  state,
  hero,
  choices,
  onAnswer,
  disabled = false,
}: DecisionControlsProps) {
  const toCall = amountToCall(state, hero);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wider text-ink-muted">
        Your action{toCall > 0 ? ` — ${toCall}bb to call` : ''}
      </h3>

      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => {
          const style = actionStyle(choice.action);

          return (
            <button
              key={`${choice.action}-${choice.size ?? ''}`}
              type="button"
              disabled={disabled}
              onClick={() => onAnswer(choice)}
              data-testid={`choice-${choice.action}${choice.size === undefined ? '' : `-${choice.size}`}`}
              className={cn(
                'flex items-center gap-2 rounded-[var(--radius)] border-2 px-3 py-2 text-sm font-medium transition-colors',
                'text-ink hover:bg-surface-raised disabled:opacity-40',
              )}
              style={{ borderColor: style.hex }}
            >
              <span aria-hidden="true" style={{ color: style.hex }}>
                {style.glyph}
              </span>
              <span>{choice.label}</span>
              <kbd className="rounded border border-line bg-surface px-1 font-mono text-[0.6875rem] text-ink-muted">
                {choice.hint}
              </kbd>
            </button>
          );
        })}
      </div>
    </div>
  );
}
