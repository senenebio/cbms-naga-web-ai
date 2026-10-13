/**
 * Vitest type augmentation — makes `@testing-library/jest-dom` matchers
 * (e.g. `toBeInTheDocument`) available in `.test.tsx` files.
 *
 * The runtime import lives in `vitest.setup.ts`; this file only provides
 * the TypeScript type declarations so `pnpm run typecheck` passes.
 */
import '@testing-library/jest-dom/vitest';
