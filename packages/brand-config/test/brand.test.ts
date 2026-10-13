/**
 * @workspace/brand-config tests (node env — no DOM; applyBrand is tested
 * against a stub element + stubbed document.title).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BRANDS, CBMS, applyBrand } from '../src/index.js';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applyBrand', () => {
  it('sets the brand accent variables and the document title', () => {
    const el = stubElement();
    vi.stubGlobal('document', { title: 'old title', documentElement: el });
    const restore = applyBrand(CBMS, el);

    expect(el.style.getPropertyValue('--brand-primary')).toBe('#2563eb');
    expect(el.style.getPropertyValue('--brand-primary-foreground')).toBe('#ffffff');
    expect(document.title).toBe('CBMS Naga 2024');

    restore();
    expect(el.style.getPropertyValue('--brand-primary')).toBe('');
    expect(document.title).toBe('old title');
  });
});

describe('BRANDS', () => {
  it('exposes cbms as brand #1 with identity + accent', () => {
    expect(BRANDS.cbms).toBe(CBMS);
    expect(CBMS.id).toBe('cbms');
    expect(CBMS.name).toBe('CBMS Naga 2024');
    expect(CBMS.version).toBe('v1.0');
    expect(CBMS.license).toBe('CC BY-NC 4.0');
    expect(CBMS.welcomeText).toBeTruthy();
    expect(CBMS.colors.primary).toBe('#2563eb');
    expect(CBMS.colors.primaryForeground).toBe('#ffffff');
  });
});
