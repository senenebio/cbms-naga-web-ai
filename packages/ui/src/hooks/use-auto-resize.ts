/**
 * useAutoResize — auto-growing textarea hook.
 *
 * Measures `scrollHeight` on change, sets `style.height` to
 * `min(scrollHeight, cap)px`. Past the cap the textarea scrolls
 * internally (`overflow-y: auto`).
 *
 * - `resize: none` kills the browser drag handle.
 * - `overflow: hidden` until the cap is hit.
 * - Resets to single-line height after `reset()`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_CAP = 160;

export interface UseAutoResizeOptions {
  /** Maximum height in px before internal scrolling kicks in. Default 160. */
  cap?: number;
}

export interface UseAutoResizeResult {
  /** Ref to attach to the `<textarea>`. */
  ref: React.RefObject<HTMLTextAreaElement | null>;
  /** Inline styles to spread onto the `<textarea>`. */
  style: React.CSSProperties;
  /** Call after submit to reset to single-line height. */
  reset: () => void;
}

export function useAutoResize(options: UseAutoResizeOptions = {}): UseAutoResizeResult {
  const cap = options.cap ?? DEFAULT_CAP;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, cap);
    setHeight(next);
    el.style.height = `${next}px`;
  }, [cap]);

  useEffect(() => {
    resize();
  }, [resize]);

  const reset = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    setHeight(undefined);
  }, []);

  const style: React.CSSProperties = {
    resize: 'none',
    overflowY: height !== undefined && height >= cap ? 'auto' : 'hidden',
    ...(height !== undefined ? { height: `${height}px` } : {}),
  };

  return { ref, style, reset };
}
