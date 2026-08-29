const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');

const previewUrl = process.argv[2];
const outputPath = process.argv[3];
const clickSelector = process.argv[4];

if (!previewUrl || !outputPath) {
  throw new Error('Usage: electron tools/capture-local-preview.cjs <url> <output.png>');
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    width: Number(process.env.KERF_PREVIEW_WIDTH || 1600),
    height: Number(process.env.KERF_PREVIEW_HEIGHT || 1000),
    backgroundColor: '#0f1012',
    webPreferences: {
      backgroundThrottling: false,
    },
  });

  await window.loadURL(previewUrl);
  await new Promise((resolve) => setTimeout(resolve, 700));
  if (clickSelector) {
    for (const selector of clickSelector.split('>>')) {
      await window.webContents.executeJavaScript(`
        document.querySelector(${JSON.stringify(selector.trim())})?.click();
      `);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  await window.webContents.executeJavaScript(`
    document.getAnimations()
      .filter((animation) => Number.isFinite(animation.effect.getTiming().iterations))
      .forEach((animation) => animation.finish());
  `);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const visualState = await window.webContents.executeJavaScript(`
    (() => {
      const read = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        return {
          rect: element.getBoundingClientRect().toJSON(),
          opacity: style.opacity,
          filter: style.filter,
        transform: style.transform,
        display: style.display,
        width: style.width,
        height: style.height,
        maxWidth: style.maxWidth,
        maxHeight: style.maxHeight,
        aspectRatio: style.aspectRatio,
        boxSizing: style.boxSizing,
        inlineStyle: element.getAttribute('style'),
      };
      };
      return {
        app: read('.kerf-app'),
        topbar: read('.kerf-app > .kfscreen > div:first-child'),
        workspace: read('.kerf-workspace'),
        rail: read('.kerf-rail'),
        library: read('.kerf-library'),
        program: read('.kerf-program'),
        programStage: read('.kerf-program-stage'),
        programCanvas: read('.kerf-program-canvas'),
        programTransport: read('.kerf-program-transport'),
        inspector: read('.kerf-inspector'),
        timeline: read('.kerf-timeline'),
        trackList: read('.kerf-track-list'),
        timelineLanes: read('.kerf-timeline-lanes'),
        control: read('.kerf-command-button, .kerf-home-command-button'),
        screen: read('.kfscreen'),
        panel: read('.kerf-library .kfpanel'),
        mediaCard: read('.kerf-library .kfmedia'),
        veil: read('.kfveil'),
        finiteAnimations: document.getAnimations().filter(
          (animation) => Number.isFinite(animation.effect.getTiming().iterations)
        ).length,
      };
    })()
  `);
  console.log(JSON.stringify(visualState));

  const image = await window.webContents.capturePage();
  await writeFile(outputPath, image.toPNG());
  console.log(outputPath);
  app.quit();
});
