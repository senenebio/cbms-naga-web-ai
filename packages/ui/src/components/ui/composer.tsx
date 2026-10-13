/**
 * Composer — auto-growing textarea for chat input.
 *
 * - Enter submits; Shift+Enter inserts a newline.
 * - Caps at 160px; scrolls internally beyond that.
 * - Resets to single-line height after submit.
 * - Disabled while a response is streaming.
 */
import { useCallback, useRef } from 'react';
import { Textarea } from './textarea';
import { Button } from './button';
import { useAutoResize } from '../../hooks/use-auto-resize';

export interface ComposerProps {
  /** Current draft text. */
  value: string;
  /** Called on every keystroke. */
  onChange: (value: string) => void;
  /** Called on Enter (not Shift+Enter) with a non-empty value. */
  onSubmit: () => void;
  /** Disable input + submit (e.g. while streaming). */
  disabled?: boolean;
  /** Placeholder text. */
  placeholder?: string;
  /** Label for the submit button. */
  submitLabel?: string;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = 'Ask a question…',
  submitLabel = 'Send',
}: ComposerProps) {
  const { ref, style, reset } = useAutoResize();
  const needsReset = useRef(false);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed && !disabled) {
          onSubmit();
          needsReset.current = true;
        }
      }
    },
    [value, disabled, onSubmit],
  );

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && !disabled) {
        onSubmit();
        needsReset.current = true;
      }
    },
    [value, disabled, onSubmit],
  );

  return (
    <form className="flex gap-2" onSubmit={handleFormSubmit}>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          // Re-measure after the value updates.
          requestAnimationFrame(() => {
            const el = ref.current;
            if (el) {
              el.style.height = 'auto';
              const next = Math.min(el.scrollHeight, 160);
              el.style.height = `${next}px`;
            }
          });
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        style={{ ...style, flex: 1 }}
        className="min-h-8 max-h-40 rounded-md border bg-transparent py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-55"
        rows={1}
        aria-label="Message"
      />
      <Button type="submit" disabled={disabled || value.trim() === ''}>
        {submitLabel}
      </Button>
    </form>
  );
}
