/*
 * `debug/eval` for the approved prototype.
 *
 * The prototype's own styling is generated inline and matched by
 * attribute selectors, so its CSS files do NOT contain the values a
 * component actually renders with — reading them tells you nothing.
 * The rendered DOM is the only place the design's real numbers exist,
 * which is why this loads the page and evaluates against it, exactly
 * as `kerf_rpc.raw('debug/eval')` does for the live app.
 *
 *   electron tools/proto_probe.cjs <url> '<js expression>'
 *
 * Sized to the app's CONTENT viewport (1440x900) rather than a window
 * size, because window chrome silently offsets every measurement and
 * makes a matching layout read as a mismatch.
 */
const { app, BrowserWindow } = require('electron');

const url = process.argv[2];
const expression = process.argv[3];
if (!url || !expression) throw new Error('Usage: electron tools/proto_probe.cjs <url> <expression>');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    useContentSize: true,
    width: Number(process.env.KERF_PROBE_WIDTH || 1440),
    height: Number(process.env.KERF_PROBE_HEIGHT || 900),
    backgroundColor: '#0c0d0f',
    webPreferences: { backgroundThrottling: false },
  });

  await window.loadURL(url);
  await new Promise((r) => setTimeout(r, 900));
  /* Settle looping animations so a measurement is not taken mid-keyframe. */
  await window.webContents.executeJavaScript(`
    document.getAnimations()
      .filter((a) => Number.isFinite(a.effect.getTiming().iterations))
      .forEach((a) => a.finish());
  `);
  await new Promise((r) => setTimeout(r, 120));

  try {
    const result = await window.webContents.executeJavaScript(expression);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('EVAL FAILED:', error.message);
    process.exitCode = 1;
  }
  app.quit();
});
