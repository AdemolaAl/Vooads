// Mail: image uploads (for email blocks) and file attachments.
// Images: PNG, JPG, GIF or WebP, checked by their first bytes (not the name or the browser's word), up to 8 MB. When ffmpeg is
// installed (Railway: nixpacks.toml) still images wider than 1600px are scaled down and re-compressed; GIFs keep their animation.
// Stored in DATA_DIR/uploads and served publicly at /media/u/<file> (emails must be able to load them).
// Attachments: PDF, PNG, JPG, ZIP, CSV or DOCX, each checked by content, at most 10 MB per campaign. Stored in
// DATA_DIR/uploads/private (never served publicly) and sent with the email through Resend's attachment field.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('../config');
const { get, all, run } = require('../db');
const { id } = require('../lib/util');

const DIR = path.join(config.dataDir, 'uploads');
const PRIV = path.join(DIR, 'private');
fs.mkdirSync(PRIV, { recursive: true });

const IMAGE_MAX = 8e6;
const FILE_MAX = 10e6;
const ATTACH_TOTAL_MAX = 10e6;
const MAX_WIDTH = 1600;
const IMG_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const FILE_TYPES = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', zip: 'application/zip', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const err = (status, message) => Object.assign(new Error(message), { status });

// What the bytes really are (by magic number). Returns a mime type or null.
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Width and height from the image header (no image library needed).
function dims(buf, mime) {
  try {
    if (mime === 'image/png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (mime === 'image/gif') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (mime === 'image/webp') {
      const kind = buf.slice(12, 16).toString('latin1');
      if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      if (kind === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {}
  return { w: 0, h: 0 };
}

function ffmpeg(args, ms = 20000) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch { return resolve(false); }
    const t = setTimeout(() => p.kill('SIGKILL'), ms);
    p.on('error', () => { clearTimeout(t); resolve(false); });
    p.on('close', (code) => { clearTimeout(t); resolve(code === 0); });
  });
}
const ffmpegReady = () => { try { return require('../stitch').available(); } catch { return false; } };

// Scale down and re-compress a still image. Returns the smaller of the original and the result.
async function optimize(buf, mime, d) {
  if (mime === 'image/gif' || process.env.MAIL_IMAGE_OPTIMIZE === '0' || !ffmpegReady()) return { buf, mime, d, optimized: false };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-img-'));
  try {
    const ext = IMG_EXT[mime];
    const inp = path.join(tmp, 'in' + ext), out = path.join(tmp, 'out' + ext);
    fs.writeFileSync(inp, buf);
    const scale = d.w > MAX_WIDTH ? ['-vf', `scale=${MAX_WIDTH}:-2:flags=lanczos`] : [];
    const q = mime === 'image/jpeg' ? ['-q:v', '4'] : mime === 'image/webp' ? ['-quality', '82'] : ['-compression_level', '9', '-pred', 'mixed'];
    if (!scale.length && mime === 'image/png' && buf.length < 300e3) return { buf, mime, d, optimized: false };
    const ok = await ffmpeg(['-i', inp, ...scale, ...q, '-frames:v', '1', out]);
    if (!ok || !fs.existsSync(out)) return { buf, mime, d, optimized: false };
    const res = fs.readFileSync(out);
    if (sniffImage(res) !== mime) return { buf, mime, d, optimized: false };
    if (!scale.length && res.length >= buf.length) return { buf, mime, d, optimized: false };
    return { buf: res, mime, d: dims(res, mime), optimized: true };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function saveImage(buf, { name, alt, staffId } = {}) {
  if (!buf || !buf.length) throw err(400, 'The file is empty.');
  if (buf.length > IMAGE_MAX) throw err(413, 'Images can be up to 8 MB.');
  const mime = sniffImage(buf);
  if (!mime) throw err(400, 'That file is not a real PNG, JPG, GIF or WebP image.');
  const d0 = dims(buf, mime);
  if (!d0.w || !d0.h || d0.w > 12000 || d0.h > 12000) throw err(400, 'We could not read this image. Try saving it again as PNG or JPG.');
  const o = await optimize(buf, mime, d0);
  const mid = id(12);
  const file = mid + IMG_EXT[mime];
  fs.writeFileSync(path.join(DIR, file), o.buf);
  run('INSERT INTO mail_media(id, kind, name, mime, size, file, width, height, alt, created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
    mid, 'image', cleanName(name, IMG_EXT[mime]), mime, o.buf.length, file, o.d.w, o.d.h, String(alt || '').slice(0, 200), staffId || null);
  return { ...view(get('SELECT * FROM mail_media WHERE id = ?', mid)), optimized: o.optimized, original_size: buf.length };
}

// Attachments: the claimed extension must match what the bytes are.
function sniffFile(buf, name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (!FILE_TYPES[ext]) return { ok: false, why: 'Attach a PDF, PNG, JPG, ZIP, CSV or DOCX file.' };
  const head = buf.slice(0, 8);
  const zip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (ext === 'pdf' && head.slice(0, 5).toString('latin1') !== '%PDF-') return { ok: false, why: 'That is not a real PDF file.' };
  if (ext === 'png' && sniffImage(buf) !== 'image/png') return { ok: false, why: 'That is not a real PNG image.' };
  if ((ext === 'jpg' || ext === 'jpeg') && sniffImage(buf) !== 'image/jpeg') return { ok: false, why: 'That is not a real JPG image.' };
  if (ext === 'zip' && !zip) return { ok: false, why: 'That is not a real ZIP file.' };
  if (ext === 'docx') {
    const s = buf.toString('latin1');
    if (!zip || !s.includes('[Content_Types].xml') || !s.includes('word/')) return { ok: false, why: 'That is not a real Word (.docx) file.' };
  }
  if (ext === 'csv') {
    if (buf.includes(0)) return { ok: false, why: 'That CSV file has binary data in it.' };
    const t = buf.toString('utf8');
    if (t.includes('�') || /<script|<html/i.test(t.slice(0, 4000))) return { ok: false, why: 'That is not a plain-text CSV file.' };
  }
  return { ok: true, mime: FILE_TYPES[ext], ext };
}
function saveFile(buf, { name, staffId } = {}) {
  if (!buf || !buf.length) throw err(400, 'The file is empty.');
  if (buf.length > FILE_MAX) throw err(413, 'Attachments can be up to 10 MB.');
  const s = sniffFile(buf, name);
  if (!s.ok) throw err(400, s.why);
  const mid = id(12);
  const file = 'private/' + mid + '.' + (s.ext === 'jpeg' ? 'jpg' : s.ext);
  fs.writeFileSync(path.join(DIR, file), buf);
  run('INSERT INTO mail_media(id, kind, name, mime, size, file, created_by) VALUES(?,?,?,?,?,?,?)', mid, 'file', cleanName(name, '.' + s.ext), s.mime, buf.length, file, staffId || null);
  return view(get('SELECT * FROM mail_media WHERE id = ?', mid));
}
function cleanName(name, ext) {
  let n = path.basename(String(name || '')).replace(/[^\w .()-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!n) n = 'file' + ext;
  return n;
}

const view = (m) => m && ({
  id: m.id, kind: m.kind, name: m.name, mime: m.mime, size: m.size, width: m.width, height: m.height, alt: m.alt || '', created_at: m.created_at,
  url: m.kind === 'image' ? '/media/u/' + m.file : null,
});
const list = (kind) => all('SELECT * FROM mail_media WHERE kind = ? ORDER BY created_at DESC, rowid DESC LIMIT 300', kind).map(view);
const byId = (mid) => get('SELECT * FROM mail_media WHERE id = ?', String(mid || ''));
function remove(mid) {
  const m = byId(mid);
  if (!m) return false;
  try { fs.unlinkSync(path.join(DIR, m.file)); } catch {}
  run('DELETE FROM mail_media WHERE id = ?', m.id);
  return true;
}
// Absolute path of a public image file (/media/u/<file>), or null.
function publicPath(file) {
  if (!/^[\w-]{6,40}\.(png|jpg|gif|webp)$/.test(String(file || ''))) return null;
  const p = path.join(DIR, file);
  return fs.existsSync(p) ? p : null;
}
// Attachments for Resend: [{ filename, content (base64) }]. Checks the total size again at send time.
function attachmentsFor(ids) {
  const rows = (ids || []).map((x) => byId(x)).filter((m) => m && m.kind === 'file');
  const total = rows.reduce((s, m) => s + m.size, 0);
  if (total > ATTACH_TOTAL_MAX) throw err(400, 'Attachments add up to more than 10 MB.');
  return rows.map((m) => ({ filename: m.name, content: fs.readFileSync(path.join(DIR, m.file)).toString('base64') }));
}
function checkAttachments(ids) {
  const rows = (Array.isArray(ids) ? ids : []).slice(0, 10).map((x) => byId(x)).filter((m) => m && m.kind === 'file');
  const total = rows.reduce((s, m) => s + m.size, 0);
  if (total > ATTACH_TOTAL_MAX) throw err(400, 'Attachments can add up to 10 MB per email. Remove one and try again.');
  return rows.map((m) => m.id);
}

module.exports = { saveImage, saveFile, sniffImage, sniffFile, dims, list, byId, view, remove, publicPath, attachmentsFor, checkAttachments, DIR, IMAGE_MAX, FILE_MAX, ATTACH_TOTAL_MAX, ffmpegReady };
