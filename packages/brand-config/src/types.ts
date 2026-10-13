/**
 * Brand identity for white-label chat apps.
 *
 * A `Brand` is the complete identity of one deployment: the text shown in the
 * UI (name, welcome, version, license) plus the brand accent color. The rest
 * of the UI theme (backgrounds, borders, muted surfaces, dark mode) comes
 * from the app framework's neutral token set — the brand only layers its
 * identity + accent on top, so adding a brand is a pure data change.
 */
export interface Brand {
  /** Stable identifier (e.g. `cbms`). */
  id: string;
  /** Display name shown in the header. */
  name: string;
  /** Welcome text shown above the first message. */
  welcomeText: string;
  /** Product version string (e.g. "v1.0"), shown in the settings footer. */
  version: string;
  /** License string (e.g. "CC BY-NC 4.0"), shown in the settings footer. */
  license: string;
  /** Brand accent: user chat bubbles + UI accents. */
  colors: {
    primary: string;
    primaryForeground: string;
  };
}
