import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

/**
 * Vite app config for the static CBMS chat app (`apps/chat-app`).
 *
 * Run from the repo root: `pnpm dev` / `pnpm build` (vite root
 * `apps/chat-app`).
 * - `apps/chat-app/public/data/` holds the bundled parquets + data dictionary,
 *   served at `/data/...` and loaded by the duckdb-wasm worker at runtime.
 * - `@repo/...` → the driver-free shared core at `packages/core/src/`.
 * - `@workspace/ui` → the shared UI package (Tailwind globals + shadcn).
 * - No `/api` proxy — this is a pure-static site (LLM is called directly).
 */
const appDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(appDir, '..', '..');

/**
 * Copy per-brand data assets into `public/data/` at the start of every
 * build (and dev server) — the same copy `prebuild` does. Running it from
 * the Vite config (not just the npm lifecycle) means the parquets are
 * bundled even when a build tool invokes `vite build` directly (e.g. a
 * Vercel framework preset), so `/data/...` assets can't 404 in deploys.
 * Brand filter: `BRAND_ID` env var, falling back to `VITE_BRAND_ID`
 * (per-brand Vercel projects set the latter).
 *
 * Note: mirrors `scripts/copy-data.mjs` (kept in sync deliberately — that
 * script stays the node CLI entry for `prebuild`/manual runs).
 */
function brandDataPlugin(): Plugin {
  return {
    name: 'copy-brand-data',
    buildStart() {
      const dataDir = join(repoRoot, 'data');
      const out = join(appDir, 'public', 'data');
      const brandFilter = process.env.BRAND_ID ?? process.env.VITE_BRAND_ID;
      const dirs = readdirSync(dataDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      if (brandFilter && !dirs.includes(brandFilter)) {
        throw new Error(
          `[copy-brand-data] Unknown brand "${brandFilter}". Available: ${dirs.join(', ')}`,
        );
      }
      // Clean and recreate the destination so stale files never linger.
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      for (const name of dirs) {
        if (brandFilter && name !== brandFilter) continue;
        const src = join(dataDir, name);
        if (!readdirSync(src).includes('warehouse')) continue; // not a brand dir
        cpSync(src, join(out, name), { recursive: true });
        console.log(`[copy-brand-data] Copied brand "${name}" → public/data/${name}/`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), brandDataPlugin()],
  resolve: {
    alias: {
      '@repo': join(repoRoot, 'packages', 'core', 'src'),
      '@workspace/ui': join(repoRoot, 'packages', 'ui', 'src'),
    },
  },
  define: {
    // Build-time version stamp for runtime-fetched data assets (`/data/...`),
    // so each deploy fetches fresh cache keys and can never hit a stale
    // edge-cached 404 from an earlier deployment.
    __DATA_VERSION__: JSON.stringify(Date.now().toString(36)),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor libs into a separate cacheable chunk so app-code
          // updates don't bust the React/react-dom cache.
          vendor: ['react', 'react-dom', 'react-dom/client'],
        },
      },
    },
  },
});
