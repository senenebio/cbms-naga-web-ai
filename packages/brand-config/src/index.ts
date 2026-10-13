/**
 * @workspace/brand-config — white-label brand identity.
 *
 * Source-only package: the consuming app's bundler compiles this TS directly.
 */
export type { Brand, Dataset, DictEntry } from './types.js';
export { applyBrand } from './applyBrand.js';
export { CBMS, BRANDS } from './brands/cbms.js';
export { CBMS_DATASET } from './datasets/cbms.js';
