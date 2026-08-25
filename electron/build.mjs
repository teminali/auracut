/* ═══════════════════════════════════════════════════════════════════
   Compiles the Electron layer.

   Both halves are emitted as CommonJS with an explicit `.cjs` extension.

   That extension is load-bearing: package.json declares
   `"type": "module"`, so a plain `.js` file would be treated as ESM —
   and an ESM entry point inside an asar archive fails to load silently
   on Electron 34 (the process exits 0 having printed nothing). A
   context-isolated preload has the same constraint for a different
   reason: it runs in a sandboxed scope with no ESM loader at all.

   Both are bundled rather than merely transpiled so the packaged app
   never has to resolve bare imports out of node_modules at runtime.
   ═══════════════════════════════════════════════════════════════════ */

import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  // Electron and anything with native bindings must stay external — they
  // are resolved from the runtime, not bundled into it.
  external: ['electron', 'electron-updater', 'electron-log'],
  sourcemap: process.env.NODE_ENV !== 'production',
  logLevel: 'info',
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.cjs',
    format: 'cjs',
  }),
  build({
    ...shared,
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.cjs',
    format: 'cjs',
  }),
]);
