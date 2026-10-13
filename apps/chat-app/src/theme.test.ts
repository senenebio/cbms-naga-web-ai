/**
 * Phase F — theme tests (ported from the reference UI, adapted to a node
 * environment: `document`/`window`/`localStorage` are stubbed, no jsdom).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getInitialTheme, applyTheme, saveTheme } from './theme';

function makeElement() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
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
    htmlElement.attributes.clear();
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

  it('applyTheme sets data-theme on <html>', () => {
    applyTheme('dark');
    expect(htmlElement.attributes.get('data-theme')).toBe('dark');
  });

  it('saveTheme writes to localStorage', () => {
    saveTheme('dark');
    expect(setItem).toHaveBeenCalledWith('cbms-theme', 'dark');
  });
});
