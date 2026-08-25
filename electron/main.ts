import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import http from 'http';
import { initAutoUpdater } from './updater';

/*
  This file is bundled to CommonJS (`main.cjs`), so `__dirname` is native
  and no import.meta shim is needed. CJS is deliberate: an ESM entry point
  inside an asar archive fails to load silently on Electron 34 — the
  process exits 0 having printed nothing, which is an awful thing to debug.
*/

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    // The renderer draws its own title bar; on macOS we only inset the
    // traffic lights into it. `--titlebar-inset` in the CSS reserves the
    // matching gutter, so the two stay in step.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 13 },
    // Matches --stage, so the window never flashes white before first paint.
    backgroundColor: '#060709',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  // Painting into a hidden window and revealing it once ready avoids the
  // white flash every Electron app gets for free otherwise.
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (!app.isPackaged) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  initAutoUpdater(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('dialog:openMedia', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media Files', extensions: ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'aac', 'png', 'jpg', 'jpeg', 'webp'] },
    ],
  });
  return result.filePaths;
});

ipcMain.handle('dialog:saveExport', async (_, defaultName: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'AuraCut_Render_Master.mp4',
    filters: [
      { name: 'MP4 Video (H.264 / HEVC)', extensions: ['mp4'] },
      { name: 'Apple ProRes 422', extensions: ['mov'] },
    ],
  });
  return result.filePath;
});

function startEmbeddedMcpHttpServer() {
  const sseClients = new Set<http.ServerResponse>();

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/sse') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"type": "connected", "server": "auracut-mcp", "port": 3888}\n\n');
      sseClients.add(res);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    if (req.url === '/mcp/tools' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'AuraCut MCP Server 1.0.0', port: 3888 }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(3888, () => {
    console.log('[AuraCut Electron] Embedded MCP Server running on http://localhost:3888/sse');
  });
}

app.whenReady().then(() => {
  createWindow();
  startEmbeddedMcpHttpServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
