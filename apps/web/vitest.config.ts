import { defineConfig } from 'vitest/config';

/**
 * Next uses `jsx: preserve` so its own compiler can transform JSX. Vitest runs
 * files through esbuild directly, which needs the automatic runtime instead —
 * without this, every .tsx spec fails to parse.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', include: ['src/**/*.spec.{ts,tsx}'] },
});
