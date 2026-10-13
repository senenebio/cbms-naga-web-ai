import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Mirror of the `__DATA_VERSION__` define in `apps/chat-app/vite.config.ts`
  // (app tests import modules that reference it; a static value is fine in tests).
  define: {
    __DATA_VERSION__: JSON.stringify('test'),
  },
  resolve: {
    alias: {
      '@repo': join(rootDir, 'packages/core/src'),
      '@workspace/ui': join(rootDir, 'packages/ui/src'),
    },
  },
  test: {
    include: [
      'test/**/*.test.ts',
      'apps/chat-app/src/**/*.test.{ts,tsx}',
      'packages/brand-config/test/**/*.test.ts',
      'packages/ui/**/*.test.{ts,tsx}',
    ],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
