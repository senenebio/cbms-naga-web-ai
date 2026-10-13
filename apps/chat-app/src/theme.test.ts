/**
 * Phase F — theme tests (ported from the reference UI, adapted to a node
 * environment: `document`/`window`/`localStorage` are stubbed, no jsdom).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getInitialTheme, applyTheme, saveTheme } from './theme';

function makeElement() {
  const classes = new Set<string>();
  return {
    classList: {
      toggle(name: string, force?: boolean) {
        if (force === true || force === undefined) classes.add(name);
        else classes.delete(name);
        return classes.has(name);
      },
      contains: (name: string) => classes.has(name),
      clear: () => classes.clear(),
    },
  };
}

describe('theme', () => {
  const htmlElement = makeElement();
  let getItem: ReturnType<typeof vi.fn>;
  let setItem: ReturnType<typeof vi.fn>;
  let removeItem: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getItem = vi.fn();
    setItem = vi.fn();
    removeItem = vi.fn();
    htmlElement.classList.clear();
    vi.stubGlobal('localStorage', { getItem, setItem, removeItem });
    vi.stubGlobal('document', { documentElement: htmlElement });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to light when no stored value and no media query', () => {
    getItem.mockReturnValue(null);
    expect(getInitialTheme()).toBe('light');
  });

  it('prefers the stored value when present', () => {
    getItem.mockReturnValue('dark');
    expect(getInitialTheme()).toBe('dark');
  });

  it('follows system preference when no stored value', () => {
    getItem.mockReturnValue(null);
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q === '(prefers-color-scheme: dark)' }),
    });
    expect(getInitialTheme()).toBe('dark');
  });

  it('ignores invalid stored values', () => {
    getItem.mockReturnValue('bogus');
    expect(getInitialTheme()).toBe('light');
  });

  it('applyTheme toggles the .dark class on <html>', () => {
    applyTheme('dark');
    expect(htmlElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    expect(htmlElement.classList.contains('dark')).toBe(false);
  });

  it('saveTheme writes to localStorage', () => {
    saveTheme('dark');
    expect(setItem).toHaveBeenCalledWith('cbms-theme', 'dark');
  });
});
