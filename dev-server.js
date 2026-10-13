'use strict';

// Tiny local server: serves ./public and runs the same handlers Vercel runs from ./api.
// Usage: node dev-server.js   (PORT defaults to 3000; reads .env if present)

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const handlers = {};
function handlerFor(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return null;
  if (!(name in handlers)) {
    const file = path.join(ROOT, 'api', `${name}.js`);
    handlers[name] = fs.existsSync(file) ? require(file) : null;
  }
  return handlers[name];
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    const { pathname } = new URL(req.url, 'http://localhost');
    res.on('finish', () => {
      if (pathname.startsWith('/api/')) {
        console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
      }
    });
    if (pathname.startsWith('/api/')) {
      const handler = handlerFor(pathname.slice(5).replace(/\/$/, ''));
      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"Not found"}');
        return;
      }
      try {
        await handler(req, res);
      } catch (err) {
        console.error(err);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end('{"error":"Internal error"}');
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    serveStatic(req, res, pathname);
  });
}

if (require.main === module) {
  loadDotEnv();
  createServer().listen(PORT, () => {
    const key = process.env.SARVAM_API_KEY ? 'set' : 'MISSING (template fallback only, no audio)';
    console.log(`Galli Commentary on http://localhost:${PORT}  (SARVAM_API_KEY ${key})`);
  });
}

module.exports = { createServer };
