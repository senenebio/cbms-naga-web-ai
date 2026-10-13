/**
 * @workspace/brand-config tests (node env — no DOM; applyBrand is tested
 * against a stub element so it stays environment-agnostic).
 */
import { describe, it, expect } from 'vitest';
import { BRANDS, CBMS, applyBrand, applyThemeTokens, tokenName, tokensToVars } from '../src/index.js';

class StubStyle {
  private map = new Map<string, string>();
  setProperty(name: string, value: string): void {
    this.map.set(name, value);
  }
  getPropertyValue(name: string): string {
    return this.map.get(name) ?? '';
  }
  removeProperty(name: string): boolean {
    return this.map.delete(name);
  }
}

function stubElement() {
  return { style: new StubStyle() } as unknown as HTMLElement;
}

describe('tokenName', () => {
  it('maps camelCase to --kebab-case', () => {
    expect(tokenName('bg')).toBe('--bg');
    expect(tokenName('bubbleUser')).toBe('--bubble-user');
    expect(tokenName('codeBg')).toBe('--code-bg');
  });
});

describe('tokensToVars', () => {
  it('converts a full token set to CSS variable entries', () => {
    const vars = tokensToVars(CBMS.tokens.light);
    expect(vars['--bg']).toBe('#f6f7f9');
    expect(vars['--bubble-user']).toBe('#e8effc');
    expect(Object.keys(vars)).toHaveLength(17);
  });
});

describe('applyBrand', () => {
  it('sets the light tokens as CSS variables and restores on cleanup', () => {
    const el = stubElement();
    el.style.setProperty('--bg', '#previous');
    const restore = applyBrand(CBMS, el);

    expect(el.style.getPropertyValue('--bg')).toBe('#f6f7f9');
    expect(el.style.getPropertyValue('--accent')).toBe('#2563eb');

    restore();
    expect(el.style.getPropertyValue('--bg')).toBe('#previous');
    expect(el.style.getPropertyValue('--accent')).toBe('');
  });
});

describe('applyThemeTokens', () => {
  it('swaps the active palette', () => {
    const el = stubElement();
    applyBrand(CBMS, el);
    applyThemeTokens(CBMS.tokens.dark, el);
    expect(el.style.getPropertyValue('--bg')).toBe('#0f1218');
    expect(el.style.getPropertyValue('--accent')).toBe('#60a5fa');
  });
});

describe('BRANDS', () => {
  it('exposes cbms as brand #1 with identity + both palettes', () => {
    expect(BRANDS.cbms).toBe(CBMS);
    expect(CBMS.id).toBe('cbms');
    expect(CBMS.version).toBe('v1.0');
    expect(CBMS.bubble.user).toBeTruthy();
    expect(CBMS.bubble.assistant).toBeTruthy();
    expect(Object.keys(CBMS.tokens.light)).toHaveLength(17);
    expect(Object.keys(CBMS.tokens.dark)).toHaveLength(17);
  });
});
