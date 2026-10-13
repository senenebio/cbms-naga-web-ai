import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite app config for the static CBMS chat app (`apps/chat-app`).
 *
 * Run from the repo root: `pnpm dev` / `pnpm build` (vite `--root
 * apps/chat-app`).
 * - `apps/chat-app/public/data/` holds the bundled parquets + data dictionary,
 *   served at `/data/...` and loaded by the duckdb-wasm worker at runtime.
 * - `@repo/...` maps to the driver-free shared core at the repo-root `src/`.
 * - No `/api` proxy — this is a pure-static site (LLM is called directly).
 */
const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@repo': join(repoRoot, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
