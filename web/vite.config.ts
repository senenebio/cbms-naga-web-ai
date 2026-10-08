import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite app config for the static CBMS app.
 *
 * Root is `web/` (invoked from the repo root with `vite --root web`).
 * - `web/public/data/` holds the bundled parquets + data dictionary, served at
 *   `/data/...` and loaded by the duckdb-wasm worker at runtime.
 * - No `/api` proxy — this is a pure-static site (LLM is called directly).
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
