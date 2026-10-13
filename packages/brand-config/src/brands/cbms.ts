/**
 * CBMS Naga 2024 — brand #1 of the white-label chat platform.
 *
 * Tokens are the existing CBMS palette (ported from the app's `styles.css`
 * light/dark palettes), so this is a behavior-preserving identity.
 */
import type { Brand } from '../types.js';

export const CBMS: Brand = {
  id: 'cbms',
  name: 'CBMS Naga 2024',
  version: 'v1.0',
  description: 'Chat over the 2024 Naga City CBMS',
  tokens: {
    light: {
      bg: '#f6f7f9',
      panel: '#ffffff',
      ink: '#1f2430',
      muted: '#6b7280',
      accent: '#2563eb',
      onAccent: '#ffffff',
      border: '#e2e5ea',
      bubbleUser: '#e8effc',
      bubbleBot: '#f2f4f8',
      surface: '#fbfcfe',
      input: '#ffffff',
      summary: '#374151',
      codeBg: '#0f172a',
      codeInk: '#e2e8f0',
      error: '#b91c1c',
      chip: '#f8fafc',
      track: '#e9edf3',
    },
    dark: {
      bg: '#0f1218',
      panel: '#171c24',
      ink: '#e8ecf2',
      muted: '#9aa3b2',
      accent: '#60a5fa',
      onAccent: '#0b1120',
      border: '#2a3140',
      bubbleUser: '#232b3a',
      bubbleBot: '#1e242f',
      surface: '#1a2029',
      input: '#1a2029',
      summary: '#c3cad6',
      codeBg: '#0f172a',
      codeInk: '#e2e8f0',
      error: '#f28b8b',
      chip: '#1e242f',
      track: '#2a3140',
    },
  },
  bubble: { user: 'bubble-user', assistant: 'bubble-assistant' },
};

export const BRANDS = { cbms: CBMS } as const;
