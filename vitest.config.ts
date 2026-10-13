import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
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
