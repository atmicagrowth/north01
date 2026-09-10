import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * **Plan §27.1a and §27.1b — Vitest, with two projects rather than one.**
 *
 * Unit tests are pure functions and want no DOM at all; component tests need one. Running both under
 * `jsdom` would be slower for no benefit and would let a "pure" module quietly start depending on a
 * browser global — which is exactly the boundary this project spent twenty phases drawing.
 *
 * So `unit` runs in Node and `components` runs in jsdom, and a unit test that reaches for `window`
 * fails rather than passes by accident.
 *
 * ### `server-only` is aliased away
 *
 * `server-only` is not an installed package: Next aliases the bare specifier inside its own bundler,
 * which is why `payload.config.ts` may not import a guarded module (Phase 19 measured the
 * `ERR_MODULE_NOT_FOUND`). Vitest is a third loader with the same problem. The alias points at an
 * empty module, so a component that transitively imports a guarded one still resolves — and the
 * guard keeps meaning what it means in the two places that matter, the browser bundle and the CLI.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(dirname, 'src'),
      'server-only': path.resolve(dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          name: 'unit',
        },
      },
      {
        extends: true,
        test: {
          environment: 'jsdom',
          include: ['tests/components/**/*.test.tsx'],
          name: 'components',
          setupFiles: ['tests/setup/components.ts'],
        },
      },
    ],
  },
})
