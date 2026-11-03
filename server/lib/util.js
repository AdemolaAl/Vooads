const crypto = require('node:crypto');
const config = require('../config');

const KEY = crypto.createHash('sha256').update(config.appSecret).digest();

// Encrypt secrets (API keys) before they go into the database. AES-256-GCM.
function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
function decrypt(blob) {
  if (!blob) return '';
  try {
    const [iv, tag, enc] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}
const mask = (s) => (s ? (s.length <= 8 ? '••••' : s.slice(0, 4) + '••••' + s.slice(-4)) : '');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const hmac = (algo, key, data) => crypto.createHmac(algo, key).update(data).digest('hex');
const safeEqual = (a, b) => {
  const A = Buffer.from(String(a || '')), B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
const id = (n = 24) => crypto.randomBytes(n).toString('base64url');
const code6 = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const refCode = () => crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').toLowerCase().slice(0, 7);

const now = () => new Date().toISOString();
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 864e5).toISOString();
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
const clampInt = (v, min, max, d = min) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 80);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const render = (tpl, vars = {}) => String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? ''));

// True when the bytes really are the image type claimed (PNG, JPEG, WebP or GIF).
function isImage(buf, type) {
  if (!buf || buf.length < 12) return false;
  if (type === 'image/png') return buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (type === 'image/webp') return buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP';
  if (type === 'image/gif') return /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'));
  return false;
}

module.exports = { isImage, encrypt, decrypt, mask, sha256, hmac, safeEqual, id, code6, refCode, now, addDays, isEmail, clampInt, esc, slugify, sleep, render };
