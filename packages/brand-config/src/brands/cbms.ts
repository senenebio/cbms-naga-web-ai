/**
 * CBMS Naga 2024 — brand #1 of the white-label chat platform.
 */
import type { Brand } from '../types.js';
import { CBMS_DATASET } from '../datasets/cbms.js';

export const CBMS: Brand = {
  id: 'cbms',
  name: 'CBMS Naga 2024',
  welcomeText:
    "Explore Naga City's 2024 community data in plain language. I'll run the queries and visualize the answers.",
  version: '1.0.0',
  license: 'MIT',
  colors: {
    primary: '#1a3f8a',
    primaryForeground: '#ffffff',
  },
  dataset: CBMS_DATASET,
};

export const BRANDS = { cbms: CBMS } as const;

export type BrandId = keyof typeof BRANDS;
