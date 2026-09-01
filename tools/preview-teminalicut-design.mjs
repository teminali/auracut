import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { build } from 'esbuild';

const designRoot = path.resolve(process.argv[2] ?? '');
const port = Number(process.argv[3] ?? 4173);
const editorFile = 'Kerf Editor.dc.html';

if (!process.argv[2] || !Number.isInteger(port)) {
  throw new Error('Usage: node tools/preview-kerf-design.mjs <design-folder> [port]');
}

const reactBundle = await build({
  stdin: {
    contents: `
      import * as React from 'react';
      import { createRoot } from 'react-dom/client';
      window.React = React;
      window.ReactDOM = { createRoot };
    `,
    resolveDir: process.cwd(),
    sourcefile: 'react-globals.js',
    loader: 'js',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  minify: true,
});

const reactGlobals = reactBundle.outputFiles[0].contents;

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function send(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

    if (url.pathname === '/') {
      response.writeHead(302, { Location: `/${encodeURIComponent(editorFile)}` });
      response.end();
      return;
    }

    if (url.pathname === '/__react-globals.js') {
      send(response, 200, reactGlobals, mimeTypes['.js']);
      return;
    }

    const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const absolutePath = path.resolve(designRoot, requestedPath);

    if (absolutePath !== designRoot && !absolutePath.startsWith(`${designRoot}${path.sep}`)) {
      send(response, 403, 'Forbidden');
      return;
    }

    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      send(response, 404, 'Not found');
      return;
    }

    const extension = path.extname(absolutePath).toLowerCase();
    let body = await readFile(absolutePath);

    if (absolutePath.endsWith('.dc.html')) {
      const html = body.toString('utf8').replace(
        '<script src="./support.js"></script>',
        '<script src="/__react-globals.js"></script>\n<script src="./support.js"></script>',
      );
      body = Buffer.from(html);
    }

    send(response, 200, body, mimeTypes[extension] ?? 'application/octet-stream');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      send(response, 404, 'Not found');
      return;
    }
    console.error(error);
    send(response, 500, 'Preview server error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Kerf design preview: http://127.0.0.1:${port}/`);
});

