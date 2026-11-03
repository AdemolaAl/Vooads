// Tiny router on top of node:http. No framework needed.
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.srt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

function parseCookies(h = '') {
  const out = {};
  h.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// Answer 413 and close the connection once the answer is sent. Destroying the request at once would also kill the
// response, so the browser saw a network error instead of "too big".
function tooBig(req) {
  req.removeAllListeners('data'); req.pause();
  if (req.res && !req.res.headersSent) { req.res.setHeader('Connection', 'close'); req.res.once('finish', () => req.destroy()); } else req.destroy();
  return new HttpError(413, 'That upload is too big.');
}
function readBody(req, limit = 2e6) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) return reject(tooBig(req)); // refuse before reading anything
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) return reject(tooBig(req));
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createRouter() {
  const routes = [];
  const add = (method, pattern, ...handlers) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }).replace(/\*$/, '(.*)') + '/?$');
    routes.push({ method, re, keys, handlers });
  };
  const api = {
    get: (p, ...h) => add('GET', p, ...h), post: (p, ...h) => add('POST', p, ...h),
    put: (p, ...h) => add('PUT', p, ...h), del: (p, ...h) => add('DELETE', p, ...h),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
        const m = pathname.match(r.re);
        if (m) {
          const params = {};
          r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
          return { handlers: r.handlers, params };
        }
      }
      return null;
    },
  };
  return api;
}

function decorate(req, res) {
  const url = new URL(req.url, 'http://x');
  req.path = url.pathname;
  req.query = Object.fromEntries(url.searchParams);
  req.cookies = parseCookies(req.headers.cookie);
  req.res = res;
  req.ip = (req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean).pop() || req.socket.remoteAddress;
  res.json = (data, status = 200) => {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  res.html = (html, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  };
  res.redirect = (to, status = 302) => { res.writeHead(status, { Location: to }); res.end(); };
  res.cookie = (name, value, opts = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    if (opts.secure) parts.push('Secure');
    const prev = res.getHeader('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [].concat(prev, parts.join('; ')));
  };
}

async function parseJson(req) {
  if (req.body !== undefined) return req.body;
  const raw = await readBody(req);
  req.rawBody = raw;
  const ct = req.headers['content-type'] || '';
  if (!raw.length) return (req.body = {});
  if (ct.includes('application/json')) {
    try { req.body = JSON.parse(raw.toString('utf8')); } catch { fail(400, 'Invalid JSON'); }
  } else if (ct.includes('application/x-www-form-urlencoded')) {
    req.body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  } else req.body = {};
  return req.body;
}

function serveStatic(root, req, res, { maxAge = 3600, path: forced } = {}) {
  let p;
  try { p = decodeURIComponent(forced || req.path); } catch { return false; }
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) return false;
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;
  const headers = { 'Content-Type': type, 'Cache-Control': `public, max-age=${maxAge}`, 'Accept-Ranges': 'bytes' };
  if (range && /^bytes=/.test(range)) {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = Number(s) || 0;
    const end = e ? Math.min(Number(e), stat.size - 1) : stat.size - 1;
    if (start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return true; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end(), true;
  fs.createReadStream(file).pipe(res);
  return true;
}

// Simple in-memory rate limiter (per IP + key).
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t);
  hits.set(key, arr);
  if (arr.length > max) fail(429, 'Too many tries. Wait a minute and try again.');
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.some((x) => t - x < 36e5)) hits.delete(k); }, 6e5).unref();

module.exports = { tooBig, createRouter, decorate, parseJson, readBody, serveStatic, HttpError, fail, rateLimit, MIME };
