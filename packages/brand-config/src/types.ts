/**
 * Brand identity + theming tokens for white-label chat apps.
 *
 * A `Brand` is the complete identity of one deployment: name/version
 * (displayed in the UI) plus the light/dark token sets that theme the whole
 * app via CSS custom properties. Apps pick exactly one brand at build time
 * (`import { BRANDS } from '@workspace/brand-config'` → `BRANDS.cbms`).
 */

/**
 * One theming palette. Keys are camelCase; `tokensToVars` maps them to the
 * `--kebab-case` CSS custom properties the components read.
 */
export interface BrandTokens {
  bg: string;
  panel: string;
  ink: string;
  muted: string;
  accent: string;
  onAccent: string;
  border: string;
  bubbleUser: string;
  bubbleBot: string;
  surface: string;
  input: string;
  summary: string;
  codeBg: string;
  codeInk: string;
  error: string;
  chip: string;
  track: string;
}

export interface Brand {
  /** Stable identifier (e.g. `cbms`). */
  id: string;
  /** Display name shown in the UI (e.g. "CBMS Naga 2024"). */
  name: string;
  /** Product version string (e.g. "v1.0"). */
  version: string;
  /** One-line description (e.g. "Chat over the 2024 Naga City CBMS"). */
  description: string;
  /** Light + dark palettes, applied as CSS variables by the app. */
  tokens: { light: BrandTokens; dark: BrandTokens };
  /** Chat-bubble class names (per-brand skinning hook). */
  bubble: { user: string; assistant: string };
}
