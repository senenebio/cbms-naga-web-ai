/**
 * Map feature (P3, T3.6) — the "Show map" trigger in the result section.
 *
 * A per-result collapsible control: the map is hidden until requested (M2),
 * and state is per-result (each instance owns its open/closed state), not
 * global. Rendered only for applicable results (see `isMapApplicable`).
 */
import { useState } from 'react';
import type { Theme } from '../theme.js';
import BarangayMap from './BarangayMap.js';

interface MapSectionProps {
  columns: string[];
  rows: unknown[][];
  theme: Theme;
}

export default function MapSection({ columns, rows, theme }: MapSectionProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="map-section">
      <button
        type="button"
        className="map-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide map' : 'Show map'}
      </button>
      {open && <BarangayMap columns={columns} rows={rows} theme={theme} />}
    </div>
  );
}
