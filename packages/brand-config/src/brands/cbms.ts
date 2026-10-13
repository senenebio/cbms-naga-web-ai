/**
 * CBMS Naga 2024 — brand #1 of the white-label chat platform.
 */
import type { Brand } from '../types.js';

export const CBMS: Brand = {
  id: 'cbms',
  name: 'CBMS Naga 2024',
  welcomeText:
    'Ask about the 2024 Naga City CBMS — households, persons, and barangays.',
  version: 'v1.0',
  license: 'CC BY-NC 4.0',
  colors: {
    primary: '#2563eb',
    primaryForeground: '#ffffff',
  },
};

export const BRANDS = { cbms: CBMS } as const;
