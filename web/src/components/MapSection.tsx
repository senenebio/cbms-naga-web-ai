/**
 * Map feature — the "Show map" trigger in the result section.
 *
 * A per-result collapsible control: the map is hidden until requested (M2),
 * and state is per-result (each instance owns its open/closed state), not
 * global. Rendered only for applicable results (see `isMapApplicable`).
 *
 * The Leaflet map is loaded on demand (`React.lazy` + dynamic `import()`) so
 * Leaflet (~140 KB) lives in its own chunk and is not part of the main bundle
 * (same pattern as `ChartBlock`/Recharts).
 */
import { Suspense, lazy, useState } from 'react';
import type { Theme } from '../theme.js';

const LeafletBarangayMap = lazy(() => import('./LeafletBarangayMap.js'));

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
      {open && (
        <Suspense fallback={<div className="note">Loading map…</div>}>
          <LeafletBarangayMap columns={columns} rows={rows} theme={theme} />
        </Suspense>
      )}
    </div>
  );
}
