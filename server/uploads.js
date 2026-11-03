// Customer video uploads for "Change background" and "Auto-edit my video" (SPEC §14).
// Files are private: stored under DATA_DIR/uploads/<user id>/ (never under /media), streamed to disk with a hard size cap,
// checked by magic bytes and then by ffprobe (duration, streams, size, frame rate). AI providers (fal) fetch them through a
// short-lived signed link: APP_URL/u/<id>.<ext>?e=<expiry>&s=<hmac>. Every user has a storage quota and files are deleted
// after N days (Admin → Profit guard → limits: upload_quota_mb, upload_keep_days).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { db, get, all, run } = require('./db');
const config = require('./config');
const { id: rid, hmac, safeEqual } = require('./lib/util');
const { fail } = require('./lib/http');

db.exec(`CREATE TABLE IF NOT EXISTS user_uploads (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, purpose TEXT, mime TEXT, file TEXT NOT NULL, name TEXT,
  bytes INTEGER NOT NULL DEFAULT 0, duration REAL, width INTEGER, height INTEGER, fps REAL, has_audio INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS user_uploads_user ON user_uploads(user_id, deleted_at);`);

const DIR = path.join(config.dataDir, 'uploads');
fs.mkdirSync(DIR, { recursive: true });

// What each tool accepts. Seconds are checked against ffprobe, bytes while streaming.
const PURPOSES = {
  bg_swap: { label: 'Change background', max_seconds: 120, max_bytes: 200e6 },
  auto_edit: { label: 'Auto-edit my video', max_seconds: 300, max_bytes: 500e6 },
  mad_edit: { label: 'Viral edit', max_seconds: 180, max_bytes: 300e6 },
  actor_consent: { label: 'Actor consent clip', max_seconds: 60, max_bytes: 80e6 },
};
const VIDEO_MIME = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };

function limits() {
  const L = require('./settings').getSetting('limits') || {};
  return { quota_mb: Number(L.upload_quota_mb) >= 0 && L.upload_quota_mb !== undefined ? Number(L.upload_quota_mb) : 2000, keep_days: Number(L.upload_keep_days) > 0 ? Number(L.upload_keep_days) : 7 };
}

// ---------- Magic bytes ----------
// MP4 / MOV: an ISO-BMFF box at offset 0 ("ftyp", or a QuickTime "moov"/"mdat"/"wide"/"free" atom). WebM: EBML header.
function sniffVideo(head) {
  if (!head || head.length < 12) return null;
  const box = head.slice(4, 8).toString('latin1');
  if (box === 'ftyp') {
    const brand = head.slice(8, 12).toString('latin1');
    return /^qt  $/.test(brand) ? 'video/quicktime' : 'video/mp4';
  }
  if (['moov', 'mdat', 'wide', 'free', 'skip'].includes(box)) return 'video/quicktime';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video/webm';
  return null;
}

// ---------- Probing ----------
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
let probeBin = null;
function hasFfprobe() {
  if (probeBin !== null) return probeBin;
  try { probeBin = spawnSync(FFPROBE, ['-version'], { timeout: 8000 }).status === 0; } catch { probeBin = false; }
  return probeBin;
}
// {duration, width, height, fps, has_audio, has_video, codec}. Falls back to the ffmpeg banner when ffprobe is missing.
function probe(file) {
  if (hasFfprobe()) {
    const r = spawnSync(FFPROBE, ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30000, maxBuffer: 8e6 });
    let j = null;
    try { j = JSON.parse(String(r.stdout || '')); } catch { j = null; }
    if (!j || !Array.isArray(j.streams)) return { ok: false, error: 'This file could not be read as a video.' };
    const v = j.streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
    const a = j.streams.find((s) => s.codec_type === 'audio');
    const rate = (x) => { const [n, d] = String(x || '0/1').split('/').map(Number); return d ? n / d : n || 0; };
    const duration = Number(j.format?.duration) || Number(v?.duration) || 0;
    return { ok: !!v && duration > 0, duration, width: Number(v?.width) || 0, height: Number(v?.height) || 0, fps: Math.round((rate(v?.avg_frame_rate) || rate(v?.r_frame_rate)) * 100) / 100, has_audio: !!a, has_video: !!v, codec: v?.codec_name || '' };
  }
  const stitch = require('./stitch');
  if (!stitch.available()) return { ok: false, error: 'Video uploads need ffmpeg on the server. Ask the admin to install it.' };
  const p = stitch.probe(file);
  return { ok: p.video && p.duration > 0, duration: p.duration, width: 0, height: 0, fps: 0, has_audio: p.audio, has_video: p.video, codec: '' };
}

// ---------- Storage ----------
const userDir = (userId) => { const d = path.join(DIR, String(Number(userId))); fs.mkdirSync(d, { recursive: true }); return d; };
const usedBytes = (userId) => Number(get('SELECT COALESCE(SUM(bytes),0) AS b FROM user_uploads WHERE user_id = ? AND deleted_at IS NULL', userId).b) || 0;

// Stream the request body to `file`, never more than `max` bytes. Resolves with the byte count.
function streamToFile(req, file, max) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file, { flags: 'wx' });
    let size = 0, done = false;
    const stop = (err) => { if (done) return; done = true; out.destroy(); try { fs.unlinkSync(file); } catch {} req.unpipe?.(out); req.resume(); reject(err); };
    req.on('data', (c) => { size += c.length; if (size > max) stop(Object.assign(new Error(`That file is too big (max ${Math.round(max / 1e6)} MB).`), { status: 413 })); });
    req.on('error', stop);
    req.on('aborted', () => stop(Object.assign(new Error('The upload was interrupted. Try again.'), { status: 400 })));
    out.on('error', stop);
    out.on('finish', () => { if (!done) { done = true; resolve(size); } });
    req.pipe(out);
  });
}

// Limits for a purpose: the video type's "upload" block in pricing (Admin → Pricing) wins over the defaults above, within
// hard ceilings (10 minutes, 1 GB).
function purpose(p) {
  if (!PURPOSES[p]) return null;
  let u = null;
  try { u = require('./videotypes').byId(p)?.upload || null; } catch { u = null; }
  const secs = Number(u?.max_seconds), mb = Number(u?.max_mb);
  return { ...PURPOSES[p], max_seconds: secs > 0 ? Math.min(600, secs) : PURPOSES[p].max_seconds, max_bytes: mb > 0 ? Math.min(1000, mb) * 1e6 : PURPOSES[p].max_bytes };
}

// Save one video upload for `purpose`. Returns the public view of the row.
async function saveVideo(req, user, purposeId, name = '') {
  const P = purpose(purposeId);
  const purpose_ = purposeId;
  if (!P) fail(400, 'Pick what the video is for.');
  const declared = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!VIDEO_MIME[declared]) fail(400, 'Upload an MP4, MOV or WebM video.');
  const len = Number(req.headers['content-length']) || 0;
  if (len > P.max_bytes) fail(413, `That file is too big (max ${Math.round(P.max_bytes / 1e6)} MB).`);
  const L = limits();
  const used = usedBytes(user.id);
  if (L.quota_mb > 0 && used + Math.max(len, 1) > L.quota_mb * 1e6) fail(413, `Your upload space is full (${Math.round(used / 1e6)} of ${L.quota_mb} MB). Delete old uploads or wait: files are removed after ${L.keep_days} days.`, { quota_mb: L.quota_mb, used_mb: Math.round(used / 1e6) });
  const uid = rid(12);
  const tmp = path.join(userDir(user.id), uid + '.part');
  let bytes;
  try { bytes = await streamToFile(req, tmp, Math.min(P.max_bytes, L.quota_mb > 0 ? L.quota_mb * 1e6 - used : P.max_bytes)); }
  catch (e) { fail(e.status || 400, e.message); }
  const clean = () => { try { fs.unlinkSync(tmp); } catch {} };
  if (bytes < 1024) { clean(); fail(400, 'That file is empty.'); }
  const head = Buffer.alloc(16);
  const fd = fs.openSync(tmp, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
  const real = sniffVideo(head);
  if (!real) { clean(); fail(400, 'That file is not a real MP4, MOV or WebM video.'); }
  const info = probe(tmp);
  if (!info.ok) { clean(); fail(400, info.error || 'That video could not be read. Export it again as MP4 (H.264) and retry.'); }
  if (info.duration > P.max_seconds + 0.5) { clean(); fail(400, `That video is ${Math.round(info.duration)}s long. ${P.label} takes videos up to ${P.max_seconds >= 120 ? P.max_seconds / 60 + ' minutes' : P.max_seconds + 's'}.`, { max_seconds: P.max_seconds, duration: info.duration }); }
  const file = uid + VIDEO_MIME[real];
  fs.renameSync(tmp, path.join(userDir(user.id), file));
  run('INSERT INTO user_uploads(id, user_id, kind, purpose, mime, file, name, bytes, duration, width, height, fps, has_audio) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    uid, user.id, 'video', purpose_, real, file, String(name || '').replace(/[\u0000-\u001f]/g, '').slice(0, 120) || null, bytes, info.duration, info.width, info.height, info.fps, info.has_audio ? 1 : 0);
  return view(byId(uid));
}

// Store a file the server made (extracted audio, an intermediate render) as a private upload of the user.
function saveLocal(userId, srcFile, mime, purpose = 'work') {
  const uid = rid(12);
  const ext = path.extname(srcFile) || '.bin';
  const file = uid + ext;
  fs.copyFileSync(srcFile, path.join(userDir(userId), file));
  const bytes = fs.statSync(path.join(userDir(userId), file)).size;
  run('INSERT INTO user_uploads(id, user_id, kind, purpose, mime, file, bytes) VALUES(?,?,?,?,?,?,?)', uid, userId, mime.split('/')[0], purpose, mime, file, bytes);
  return byId(uid);
}

const byId = (id) => get('SELECT * FROM user_uploads WHERE id = ? AND deleted_at IS NULL', String(id || ''));
// The upload when it belongs to the user (never someone else's).
function owned(id, userId) {
  const u = byId(id);
  return u && u.user_id === userId ? u : null;
}
const filePath = (u) => (u ? path.join(DIR, String(u.user_id), u.file) : null);
const view = (u) => u && { id: u.id, kind: u.kind, purpose: u.purpose, name: u.name, bytes: u.bytes, duration: u.duration, width: u.width, height: u.height, fps: u.fps, has_audio: !!u.has_audio, created_at: u.created_at, preview_url: signedPath(u, 6 * 3600) };

// ---------- Signed links ----------
const sig = (id, exp) => hmac('sha256', config.appSecret, 'upload:' + id + ':' + exp).slice(0, 32);
function signedPath(u, ttlSec = 24 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `/u/${u.id}${path.extname(u.file)}?e=${exp}&s=${sig(u.id, exp)}`;
}
const signedUrl = (u, ttlSec) => config.appUrl + signedPath(u, ttlSec);
function verify(id, exp, s) {
  if (!/^[\w-]{6,40}$/.test(String(id)) || !/^\d{9,12}$/.test(String(exp))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  if (!safeEqual(sig(id, exp), s)) return null;
  return byId(id);
}

// ---------- Cleanup ----------
// Deletes uploads older than keep_days that no running job still needs. Returns how many were removed.
function cleanup() {
  const { keep_days } = limits();
  const cutoff = new Date(Date.now() - keep_days * 864e5).toISOString().replace('T', ' ').slice(0, 19);
  const busy = new Set();
  for (const j of all("SELECT input FROM jobs WHERE status IN ('queued','running')")) { try { const i = JSON.parse(j.input || '{}'); if (i.upload_id) busy.add(i.upload_id); } catch {} }
  let n = 0;
  for (const u of all('SELECT * FROM user_uploads WHERE deleted_at IS NULL AND created_at < ?', cutoff)) {
    if (busy.has(u.id)) continue;
    remove(u);
    n++;
  }
  // Half-written files from crashed uploads.
  try {
    for (const d of fs.readdirSync(DIR)) {
      const sub = path.join(DIR, d);
      for (const f of fs.readdirSync(sub)) if (f.endsWith('.part') && Date.now() - fs.statSync(path.join(sub, f)).mtimeMs > 6 * 3600e3) fs.unlinkSync(path.join(sub, f));
    }
  } catch {}
  return n;
}
function remove(u) {
  try { fs.unlinkSync(filePath(u)); } catch {}
  run('UPDATE user_uploads SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', u.id);
}
const list = (userId) => all("SELECT * FROM user_uploads WHERE user_id = ? AND deleted_at IS NULL AND kind = 'video' AND purpose != 'work' ORDER BY created_at DESC LIMIT 50", userId).map(view);

module.exports = { purpose, PURPOSES, VIDEO_MIME, DIR, sniffVideo, probe, hasFfprobe, saveVideo, saveLocal, byId, owned, filePath, view, signedPath, signedUrl, verify, cleanup, remove, list, usedBytes, limits, streamToFile };
