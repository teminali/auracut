import { defineConfig } from 'vitest/config';
import path from 'path';

/*
  Unit tests for the pure layer only — no Electron, no renderer, no app.

  Deliberately NOT reusing `vite.config.ts`: that pulls in the React
  plugin, which costs a transform pass on every file for tests that never
  render a component. The `@` alias is carried across because the store
  modules use it and `projectIO` imports them.

  Default environment is `node`. The one suite that needs a DOM says so
  itself with an `@vitest-environment jsdom` docblock, so the reason lives
  next to the code that needs it rather than in a global switch.
*/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
