/**
 * @workspace/brand-config — white-label brand identity + theming.
 *
 * Source-only package: the consuming app's bundler compiles this TS directly.
 */
export type { Brand, BrandTokens } from './types.js';
export { applyBrand, applyThemeTokens, tokenName, tokensToVars } from './applyBrand.js';
export { CBMS, BRANDS } from './brands/cbms.js';
