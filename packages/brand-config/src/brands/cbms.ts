/**
 * CBMS Naga 2024 — brand #1 of the white-label chat platform.
 */
import type { Brand } from '../types.js';

export const CBMS: Brand = {
  id: 'cbms',
  name: 'CBMS Naga 2024',
  welcomeText:
    "Explore Naga City's 2024 community data in plain language. I'll run the queries and visualize the answers.",
  version: '1.0.0',
  license: 'MIT',
  colors: {
    primary: '#2563eb',
    primaryForeground: '#ffffff',
  },
};

export const BRANDS = { cbms: CBMS } as const;
