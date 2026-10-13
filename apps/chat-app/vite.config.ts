import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite app config for the static CBMS chat app (`apps/chat-app`).
 *
 * Run from the repo root: `pnpm dev` / `pnpm build` (vite root
 * `apps/chat-app`).
 * - `apps/chat-app/public/data/` holds the bundled parquets + data dictionary,
 *   served at `/data/...` and loaded by the duckdb-wasm worker at runtime.
 * - `@repo/...` → the driver-free shared core at the repo-root `src/`.
 * - `@workspace/ui` → the shared UI package (Tailwind globals + shadcn).
 * - No `/api` proxy — this is a pure-static site (LLM is called directly).
 */
const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@repo': join(repoRoot, 'src'),
      '@workspace/ui': join(repoRoot, 'packages', 'ui', 'src'),
    },
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
