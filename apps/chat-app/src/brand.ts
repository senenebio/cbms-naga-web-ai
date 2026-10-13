/**
 * Build-time brand selection for this app: it ships the CBMS brand.
 *
 * A new white-label brand = a new entry in `@workspace/brand-config`'s
 * `BRANDS` map + this one line changed. No runtime brand picker (v1).
 */
import { BRANDS } from '@workspace/brand-config';

export const BRAND = BRANDS.cbms;
