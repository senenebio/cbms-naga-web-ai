import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@repo': join(fileURLToPath(new URL('.', import.meta.url)), 'src'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'apps/chat-app/src/**/*.test.{ts,tsx}', 'packages/brand-config/test/**/*.test.ts'],
    environment: 'node',
  },
});
