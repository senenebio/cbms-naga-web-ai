/**
 * Build-time brand selection (data-aware spec B2 — build-time pairing, D1).
 *
 * `VITE_BRAND_ID` is inlined by Vite at build time, so each deployment
 * ships exactly one brand. Each Vercel project sets its own `VITE_BRAND_ID`
 * (see `vercel.json`). No runtime brand picker.
 *
 * A new white-label brand = a new entry in `@workspace/brand-config`'s
 * `BRANDS` map + its `data/<id>/` assets + a `vercel.json` project entry.
 */
import { BRANDS, type BrandId } from '@workspace/brand-config';

const id = (import.meta.env.VITE_BRAND_ID ?? 'cbms') as BrandId;
export const BRAND = BRANDS[id] ?? BRANDS.cbms;
