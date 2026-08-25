/* ═══════════════════════════════════════════════════════════════════
   afterPack — ad-hoc sign macOS builds that have no Developer ID.

   Apple Silicon will not execute a Mach-O whose signature does not match
   its contents. A packaged Electron app inherits Electron's own
   linker-signed signature, which the packaging step invalidates, so an
   unsigned arm64 build dies on launch with no output and exit code 0.

   When real signing credentials are present electron-builder handles it
   and this hook stands aside. When they are not, an ad-hoc signature is
   the difference between a build that runs and a build that does not.
   Ad-hoc is NOT a substitute for notarisation: Gatekeeper will still
   warn on first open, and the app correctly reports that it cannot
   self-update.
   ═══════════════════════════════════════════════════════════════════ */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // A real certificate means electron-builder already signed properly.
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  try {
    execFileSync(
      'codesign',
      ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
      { stdio: 'inherit' }
    );
    console.log(`  • ad-hoc signed (unsigned build) ${path.basename(appPath)}`);
  } catch (err) {
    console.warn(`  • ad-hoc signing failed: ${err.message}`);
  }
};
